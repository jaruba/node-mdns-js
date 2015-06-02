var debug = require('debug')('mdns:lib:decoder');
//var sorter = require('./sorter');
var ServiceType = require('./service_type').ServiceType;
var dns = require('mdns-js-packet');
var Record = dns.DNSRecord;


var decodeSection = module.exports.decodeSection =
function (packet, sectionName, obj) {
  if (!packet.hasOwnProperty(sectionName)) {
    debug('error in packet', packet);
    throw new Error('Section missing from packet:' + sectionName);
  }
  debug('%s has %d records', sectionName, packet[sectionName].length);

  if (typeof obj === 'undefined') {
    throw new Error('Argument obj is missing');
  }

  var records = packet[sectionName].length;
  var processed = 0;
  if (packet[sectionName].length === 0) {
    return false;
  }

  var host;

  packet.each(sectionName, function (rec) {
    processed++;
    switch (rec.type) {
      case Record.Type.A:
        host = rec.name;
        if (obj.services) {
          obj.services.forEach(function (service) {
            if (typeof service.host === 'undefined') {
              service.host = host;
            }
          });
        }
        break;
      case Record.Type.PTR:
        break;
      case Record.Type.TXT:
        debug('txt', rec);
        obj.services = obj.services || [];
        var tfound = obj.services.some(function (service) {
          if (service.fullname !== rec.name) {
            return false;
          }
          if (!service.txt) {
            service.txt = [];
          }
          service.txt = service.txt.concat(rec.data);
          return true;
        });
        if (!tfound) {
          obj.services.push({port:undefined, fullname:rec.name, ttl:undefined,
                             type:undefined, txt:[].concat(rec.data),
                             host:host});
        }

        break;
      case Record.Type.SRV:
        obj.services = obj.services || [];
        var type;
        var i = rec.name.indexOf('._');
        if (i !== -1) {
          type = new ServiceType(rec.name.slice(i + 1).replace('.local', ''));
        }
        var sfound = obj.services.some(function (service) {
          if (service.fullname !== rec.name) {
            return false;
          }
          service.port = rec.port;
          service.ttl  = rec.ttl;
          service.type = type;
          return true;
        });
        if (!sfound) {
          obj.services.push({port:rec.port, fullname:rec.name, ttl:rec.ttl,
                             type:type, txt:undefined, host:host});
        }
        break;
      case Record.Type.NSEC: //just ignore for now. Sent by chromecast for example
        processed--;
        break;
      default:
        processed--;
        debug('section: %s type: %s', sectionName, rec.type, rec);
    }
  });
  return (records > 0 && processed > 0);
};

module.exports.decodeMessage = function (message) {

  var packets = dns.DNSPacket.parse(message);
  if (!(packets instanceof Array)) {
    packets = [packets];
  }
  return decodePackets(packets, false);
};

var decodePackets = module.exports.decodePackets = function (packets,
                                                             responsesOnly) {
  var queryOnly = true;
  var data = {
    addresses: []
  };
  var query = [];
  data.query = query;

  debug('decodeMessage');
  packets.forEach(function (packet) {
    if (responsesOnly && (packet.header.qr !== 1)) {
      debug('skip', packet);
      return;
    }
    //skip query only
    debug(packet.answer.length, packet.authority.length,
      packet.additional.length);
    if (packet.answer.length === 0 &&
      packet.authority.length === 0 &&
      packet.additional.length === 0) {
      debug('skip', packet);
      return;
    }
    queryOnly = false;
    decodeSection(packet, 'answer', data);
    //decodeSection(packet, 'authority', data);
    decodeSection(packet, 'additional', data);

    packet.question.forEach(function (rec) {
      if (rec.type === dns.DNSRecord.Type.PTR) {
        query.push(rec.name);
      }
    });
  });

  if (queryOnly)
  {
    return;
  }

  return data;
};

module.exports.decodeResponsePackets = function (packets) {
  return decodePackets(packets, true);
};

