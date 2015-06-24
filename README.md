mDNS-js
==========

Forked [from kmpm/node-mdns-js](https://github.com/kmpm/node-mdns-js)

Pure JavaScript/NodeJS mDNS discovery implementation.
This implementation mimics the node-mdns behavior, works under linux at least and is compatible with avahi.
If another daemon like avahi or dns-sd is running, the port sharing feature must be available on your system.

The starting inspiration came from
https://github.com/GoogleChrome/chrome-app-samples/tree/master/mdns-browser
but adapted for node. It's not much left of that now though.



example
-------

```javascript
var mdns = require('mdns-js');

var browser = mdns.createBrowser(mdns.tcp('http'));

browser.on('ready', function () {
    browser.discover(); 
});


browser.on('serviceUp', function (service) {
  console.log('service up: ', service.name, service.address);
});

browser.on('serviceDown', function (service) {
  console.log('>>>> service down: ', service.name, service.address);
});

```



Debugging
---------
This library is using the [debug](https://github.com/visionmedia/debug) 
module from TJ Holowaychuk and can be used like this.

```bash
DEBUG=mdns:* node examples/simple.js
```

This will spit out LOTS of information that might be useful.
If you have some issues with something where you might want
to communicate the contents of a packet (ie create an issue on github)
you could limit the debug information to just that.

```bash
DEBUG=mdns:browser:packet node examples/simple.js
```

Contributing
------------
Pull-request will be gladly accepted.

If possible any api should be as close match to the api of node-mdns but
be pragmatic. Look at issue #5.

Please run any existing tests with

    npm test

and preferably add more tests.


Before creating a pull-request please run 

    npm run lint 

This will run jshint as well as jscs that will do some basic syntax
and code style checks.
Fix any issues befor committing and creating a pull-request.

Look at the .jshintrc and .jscs.json for the details.


License
=======
Apache 2.0. See LICENSE file.



References
==========

* https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/mdns-browser
* http://en.wikipedia.org/wiki/Multicast_DNS
* http://en.wikipedia.org/wiki/Zero_configuration_networking#Service_discovery
* RFC 6762 - mDNS - http://tools.ietf.org/html/rfc6762
* RFC 6763 - DNS Based Service Discovery (DNS-SD) - http://tools.ietf.org/html/rfc6763
* http://www.tcpipguide.com/free/t_DNSMessageHeaderandQuestionSectionFormat.htm

