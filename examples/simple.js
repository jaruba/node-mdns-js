var mdns = require('../');

var TIMEOUT = 5000; //5 seconds

var browser = mdns.createBrowser(); //defaults to mdns.ServiceType.wildcard
//var browser = mdns.createBrowser(mdns.tcp('googlecast'));
//var browser = mdns.createBrowser(mdns.tcp("workstation"));

browser.on('ready', function onReady() {
  console.log('browser is ready');
  browser.discover();
});


browser.on('serviceUp', function (service) {
  console.log('service up: ', service.name, service.address);
});

browser.on('serviceDown', function (service) {
  console.log('>>>> service down: ', service.name, service.address);
});

//stop after timeout
setTimeout(function onTimeout() {
  browser.stop();
}, TIMEOUT);
