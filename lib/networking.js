var debug = require('debug')('mdns:lib:networking');
var debuginbound = require('debug')('mdns:inbound');
var debugoutbound = require('debug')('mdns:outbound');

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var os = require('os');
var dgram = require('dgram');
var semver = require('semver');

var dns = require('mdns-js-packet');
var DNSPacket = dns.DNSPacket;

var MDNS_MULTICAST = '224.0.0.251';


var Networking = module.exports = function (options) {
  options = options || {};
  this.created = 0;
  this.connections = [];
  this.started = false;
  this.users = [];
};

util.inherits(Networking, EventEmitter);


Networking.prototype.start = function () {
  // Because of the behavior of the linux udp sockets when multicasting, many
  // sockets with 2 different kinds of bindings may be needed:
  // - X sockets, each one bound to a single address/interface. Because the
  //   multicast messages must sent trought every interfaces and it is only
  //   sent via the "main" interface when binding a socket to ANY. They will be
  //   used to send the messages.
  // - 1 socket bound to ANY address. Because with linux, binding a socket to a
  //   single address works like a filtering address and the socket does not
  //   receive the multicast messages. It will be used to read the messages.

  var interfaces = os.networkInterfaces();
  var index = 0;
  var toCreate = [];

  for (var key in interfaces) {
    if (interfaces.hasOwnProperty(key)) {
      for (var i = 0; i < interfaces[key].length; i++) {
        var iface = interfaces[key][i];
        //no localhost
        if (iface.internal) {
          continue;
        }
        //no IPv6 addresses
        if (iface.address.indexOf(':') !== -1) {
          continue;
        }
        debug('interface', key, iface.address);
        toCreate.push({interfaceIndex:index++,
                        networkInterface:key,
                        address:iface.address});
      }
    }
  }

  if (toCreate.length > 1) {
    var self = this;
    toCreate.forEach(function (tc) {
      self.createSenderSocket(tc.interfaceIndex, tc.networkInterface,
          tc.address, 5353, self.bindToAddress.bind(self));
    });
  }

  this.createBindAnySocket(5353,
                           this.bindToAddress.bind(this),
                           (toCreate.length > 1) ? false : true);
};


Networking.prototype.stop = function () {
  debug('stopping');

  this.connections.forEach(closeEach);
  this.connections = [];

  function closeEach(connection) {
    var socket = connection.socket;
    socket.close();
    socket.unref();
  }
};


function createSocket()
{
  if (semver.gte(process.versions.node, '0.11.13')) {
    return dgram.createSocket({type:'udp4', reuseAddr:true});
  } else {
    return dgram.createSocket('udp4');
  }
}

Networking.prototype.createSenderSocket = function (
  interfaceIndex, networkInterface, address, port, next) {
  var sock = createSocket();
  debug('creating socket for', networkInterface, '@' + address + ':' + port);
  this.created++;

  var connection = {
    socket:sock,
    interfaceIndex: interfaceIndex,
    networkInterface: networkInterface,
    counters: {
      sent: 0,
      received: 0
    },
    sender: true
  };

  sock.bind(port, address, function () {
    sock.addMembership(MDNS_MULTICAST, address);
    sock.setMulticastTTL(255);
    sock.setMulticastLoopback(true);

    next(networkInterface, connection);
  });

};


Networking.prototype.createBindAnySocket = function (port, next, isSender) {
  var sock = createSocket();
  debug('creating receiver socket for all interfaces at port', port);
  this.created++;

  var connection = {
    socket:sock,
    interfaceIndex: 0,
    networkInterface: 'all interfaces',
    counters: {
      sent: 0,
      received: 0
    },
    sender:isSender
  };

  var self = this;

  sock.on('message', function (message, remote) {
    var packets;
    connection.counters.received++;
    debuginbound('incomming message', message.toString('hex'));
    try {
      packets = dns.DNSPacket.parse(message);
      if (!(packets instanceof Array)) {
        packets = [packets];
      }

      self.emit('packets', packets, remote, connection);
    }
    catch (err) {
      //partial, skip it
      debug('packet parsing error', err);
    }
  });

  sock.bind(port, function () {
    debug('binded to', sock.address(), port);
    sock.addMembership(MDNS_MULTICAST);
    sock.setMulticastTTL(255);
    sock.setMulticastLoopback(true);

    next('all', connection);
  });

};


Networking.prototype.bindToAddress = function (networkInterface, connection) {
  var info = connection.socket.address();
  debug('bindToAddress', networkInterface, info);

  this.connections.push(connection);
  var self = this;

  connection.socket.on('error', self.onError.bind(self));

  connection.socket.on('close', function () {
    debug('socket closed', info);
  });

  if (this.created === this.connections.length) {
    this.emit('ready', this.connections.length);
  }
};//--bindToAddress


Networking.prototype.onError = function (err) {
  this.emit('error', err);
};


Networking.prototype.send = function (packet) {
  this.connections.forEach(onEach);
  function onEach(connection) {
    if (!connection.sender) {
      return;
    }
    var sock = connection.socket;
    debug('sending via', sock.address());

    //replacing address in the answers
    var ipAddress = sock.address().address;
    packet.answer.forEach(function (answer) {
      if (answer.address !== undefined) {
        answer.address = ipAddress;
      }
    });

    var buf = DNSPacket.toBuffer(packet);
    debug('created buffer with length', buf.length);
    debugoutbound('message', buf.toString('hex'));
    sock.send(buf, 0, buf.length, 5353, MDNS_MULTICAST, function (err, bytes) {
      connection.counters.sent++;
      debug('%s sent %d bytes with err:%s', sock.address().address, bytes, err);
    });
  }
};


Networking.prototype.startRequest = function (callback) {
  if (this.started) {
    return process.nextTick(callback());
  }
  this.start();
  this.once('ready', function () {
    if (typeof callback === 'function') {
      callback();
    }
  });
};


Networking.prototype.stopRequest = function () {
  if (this.users.length === 0) {
    this.stop();
  }
};


Networking.prototype.addUsage = function (browser, next) {
  this.users.push(browser);
  this.startRequest(next);
};


Networking.prototype.removeUsage = function (browser) {
  var index = this.users.indexOf(browser);
  if (index > -1) {
    this.users.splice(index, 1);
  }
  this.stopRequest();
};

