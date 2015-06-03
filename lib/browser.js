
var debug = require('debug')('mdns:browser');

var util = require('util');
var EventEmitter = require('events').EventEmitter;


var dns = require('mdns-js-packet');
var DNSPacket = dns.DNSPacket;
var DNSRecord = dns.DNSRecord;
var ServiceType = require('./service_type').ServiceType;
var decoder = require('./decoder');
// var counter = 0;
var internal = {};

/**
 * Handles incoming UDP traffic.
 * @private
 */
internal.onMessage = function (packets, remote, connection) {
  debug('got packets from remote', remote);

  var data = decoder.decodeResponsePackets(packets);

  if (data) {
    internal.checkAndUpdateServices.bind(this)(data, remote, connection);
  }
};


internal.checkAndUpdateServices = function (data, remote, connection) {
  data.interfaceIndex = connection.interfaceIndex;
  data.networkInterface = connection.networkInterface;
  data.addresses.push(remote.address);
  if (!connection.servicesByAddress) {
    connection.servicesByAddress = {};
  }

  if (typeof data.services === 'undefined')
  {
    return;
  }
  var self = this;

  //----------------------
  function addService(servByAddr, service, addr)
  {
    if (!self.serviceType.matches(service.type)) {
      //not interested by this service
      return;
    }
    var isNew = false;
    var servByFullName;
    var fullname = service.fullname;
    if (servByAddr.hasOwnProperty(fullname)) {
      servByFullName = servByAddr[fullname];
    }
    else {
      isNew = true;
      servByFullName = servByAddr[fullname] = {name:service.fullname,
                                                port:service.port,
                                                type:service.type,
                                                txt:service.txt,
                                                address:addr,
                                                host:service.host};
      debug('new service with fullname - %s', fullname);
    }

    var ttl = servByFullName.ttl = service.ttl;
    // computing checking times : 80/85/90/95% (+ 0-2%) of TTL
    var variation = Math.floor((Math.random() * 3));
    var now = new Date().getTime() / 1000;
    var nextCheckTime = (now + ttl * (80 + variation) / 100);
    servByFullName.checkingTimes = [nextCheckTime,
                                    (now + ttl * (85 + variation) / 100),
                                    (now + ttl * (90 + variation) / 100),
                                    (now + ttl * (95 + variation) / 100)];
    servByFullName.end = now + service.ttl;

    if (!self.nextTimeoutCheckingTime ||
       (nextCheckTime < self.nextTimeoutCheckingTime)) {
      self.nextTimeoutCheckingTime = nextCheckTime;
      if (self.checkingTimeoutId) {
        clearTimeout(self.checkingTimeoutId);
      }
      debug('new timeout check in', nextCheckTime - now, 'sec');
      self.checkingTimeoutId = setTimeout(internal.checkTimeouts.bind(self),
                                          1000 * (nextCheckTime - now));
    }

    if (isNew) {
      /**
       * Update event
       * @event Browser#serviceUp
       * @type {object}
       * @property {string} name - name of the service
       * @property {string} address - IP of the service
       * @property {number} port - port of the service
       * @property {type}   type - type describing the service
       * @property {array}  txt - Array of strings containing the TXT data
       */
      self.emit('serviceUp', servByFullName);
    }
  }

  //----------------------
  function removeService(servByAddr, service)
  {
    //fullname
    var fullname = service.fullname;
    if (!servByAddr.hasOwnProperty(fullname)) {
      return;
    }

    var servByFullName = servByAddr[fullname];

    /**
     * Update event
     * @event Browser#serviceDown
     * @type {object}
     * @property {string} name - name of the service
     * @property {string} address - IP of the service
     * @property {number} port - port of the service
     * @property {type}   type - type describing the service
     * @property {array}  txt - Array of strings containing the TXT data
     */
    self.emit('serviceDown', servByFullName);
    delete servByAddr[fullname];
  }

  data.addresses.forEach(function (addr) {
    var servByAddr;
    if (connection.servicesByAddress.hasOwnProperty(addr)) {
      servByAddr = connection.servicesByAddress[addr];
    }
    else {
      servByAddr = connection.servicesByAddress[addr] = {};
    }

    data.services.forEach(function (service) {
      if (typeof service.type === 'undefined') {
        return;
      }

      if (service.ttl === 0) {
        removeService(servByAddr, service);
      }
      else {
        addService(servByAddr, service, addr);
      }
    });
  });
};


internal.checkTimeouts = function () {
  debug('checking timeouts');
  var self = this;
  var now = new Date().getTime() / 1000;
  var nextCheckTime;
  var servicesToQuery = [];
  var servicesNotToQuery = [];
  self.networking.connections.forEach(function (connection) {
    if (!connection.servicesByAddress) {
      return;
    }
    Object.keys(connection.servicesByAddress).forEach(function (addr) {
      var services = connection.servicesByAddress[addr];
      Object.keys(services).forEach(function (fullname) {
        var service = services[fullname];
        if (now >= service.end) {
          //did not receive any answer that would update the end value
          debug('service', fullname, 'is dead !');
          self.emit('serviceDown', service);
          delete services[fullname];
          return;
        }

        if (service.checkingTimes.length) {
          //still have attemps to do
          var nsct = service.checkingTimes[0];
          if (now < nsct) { //not yet, waiting
            if ((!nextCheckTime) || (nsct < nextCheckTime)) {
              nextCheckTime = nsct;
            }
            servicesNotToQuery.push(service);
            return;
          }
          //now >= nsct
          servicesToQuery.push(service);
          service.checkingTimes = service.checkingTimes.filter(function (t) {
            return t > now;
          });
        }
        else {
          servicesNotToQuery.push(service);
        }

        //if 4 attempts are done, waiting for an answer before the end
        var nct = (service.checkingTimes.length ?
                   service.checkingTimes[0] : service.end);
        if ((!nextCheckTime) || (nct < nextCheckTime)) {
          nextCheckTime = nct;
        }
      });
    });
  });

  //No request to send
  if (!servicesToQuery.length) {
    return;
  }

  //removing service that are in both lists due to duplicated services (on 2 or more interfaces)
  servicesNotToQuery = servicesNotToQuery.filter(function (sntq) {
    return (!servicesToQuery.some(function (s) {
      return s.name === sntq.name;
    }));
  });

  //creating list of unique service types and removing
  var servicesTypesToQuery = servicesToQuery.map(function (service) {
    return service.type.toString();
  }).filter(function (str, index, array) {
    return (array.indexOf(str) === index);
  });

  servicesTypesToQuery.forEach(function (serviceType) {
    //sending query to check whether the services are still alive
    debug('Sending query packet for type:', serviceType + '.local');
    var packet = new DNSPacket();
    packet.question.push(new DNSRecord(serviceType + '.local',
                                       DNSRecord.Type.PTR, 1));
    servicesNotToQuery.forEach(function (service) {
      if (service.type.toString() !== serviceType) {
        return;
      }
      var rec = new DNSRecord(service.name, DNSRecord.Type.PTR, 1, service.ttl);
      rec.data = service.name;
      packet.answer.push(rec);
    });
    self.networking.send(packet);
  });

  if (nextCheckTime) {
    self.nextTimeoutCheckingTime = nextCheckTime;
    if (self.checkingTimeoutId) {
      clearTimeout(self.checkingTimeoutId);
    }
    debug('new timeout check in', nextCheckTime - now, 'sec');
    self.checkingTimeoutId = setTimeout(internal.checkTimeouts.bind(self),
                                        1000 * (nextCheckTime - now));
  }
};


/**
 * mDNS Browser class
 * @class
 * @param {string|ServiceType} serviceType - The service type to browse for.
 * @fires Browser#serviceUp
 * @fires Browser#serviceDown
 */
var Browser = module.exports = function (networking, serviceType) {
  if (!(this instanceof Browser)) {return new Browser(serviceType); }

  var notString = typeof serviceType !== 'string';
  var notType = !(serviceType instanceof ServiceType);
  if (notString && notType) {
    debug('serviceType type:', typeof serviceType);
    debug('serviceType is ServiceType:', serviceType instanceof ServiceType);
    debug('serviceType=', serviceType);
    throw new Error('argument must be instance of ServiceType or valid string');
  }
  this.serviceType = serviceType;
  this.networking = networking;
  var self = this;

  networking.addUsage(this, function () {
    self.emit('ready');
  });

  this.stop = function () {
    networking.removeUsage(this);
  };//--start

  networking.on('packets', internal.onMessage.bind(this));

  this.discover = function () {
    var packet = new DNSPacket();
    packet.question.push(new DNSRecord(
      serviceType.toString() + '.local',
      DNSRecord.Type.PTR, 1)
    );
    networking.send(packet);
  };
};//--Browser constructor

util.inherits(Browser, EventEmitter);

