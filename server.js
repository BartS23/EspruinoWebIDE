#!/usr/bin/node
/** BETA Node.js server that allows Web IDE to be served off of a website.

Only one concurrent connection allowed at the moment.

Just start with `node server.js`, then navigate to `localhost:8080` in a web browser.
The Web IDE should start up over the network and work like normal.

*/
var WebSocketServer = require('websocket').server;
var http = require('http');

var connection;

var Espruino = { Config : {}, Core : {}, Plugins : {} };
Espruino.Config.BLUETOOTH_LOW_ENERGY = true;

Espruino.callProcessor = function(a,b,cb) { cb(); }
Espruino.Core.Status = {
 setStatus : function(t,l) { console.log(":"+t); },
 incrementProgress : function(amt) {}
};

eval(require("fs").readFileSync("EspruinoTools/core/serial.js").toString());
eval(require("fs").readFileSync("EspruinoTools/core/serial_nodeserial.js").toString());
eval(require("fs").readFileSync("EspruinoTools/core/serial_bleat.js").toString());

function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

function str2ab(str) {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);
  for (var i=0, strLen=str.length; i<strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

Espruino.Core.Serial.startListening(function(data) {
  if (connection) connection.sendUTF(ab2str(data));
});

var server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    var url = request.url.toString();
    if (url == "/") url = "/main.html";
    if (url == "/serial/ports") {
      Espruino.Core.Serial.getPorts(function(ports) {
        response.writeHead(200);
        response.end(JSON.stringify(ports,null,2));
      });
      return;
    }

    var path =  require('path').resolve(__dirname, "."+url);
    if (path.substr(0,__dirname.length)!=__dirname) {
      console.warn("Hacking attempt? ", url);
      response.writeHead(404);
      response.end();
      return;
    }

    if (require("fs").existsSync(path)) {
      console.log("Serving file ",path);
      require("fs").readFile(path, function(err, blob) {
        var mime;
        if (path.substr(-4)==".css") mime = "text/css";
        if (path.substr(-5)==".html") mime = "text/html";
        if (path.substr(-4)==".png") mime = "image/png";
        if (path.substr(-4)==".js") mime = "text/javascript";
        if (mime) response.setHeader("Content-Type", mime);
        if (url == "/main.html") {
          // make sure we load the websocket library
          
          blob = blob.toString();
          if (blob.indexOf("<!-- SERIAL_INTERFACES -->")<0) throw new Error("Expecing <!-- SERIAL_INTERFACES --> in main.html");
          blob = blob.replace("<!-- SERIAL_INTERFACES -->", '<script src="EspruinoTools/core/serial_websocket.js"></script>');
        }

        response.writeHead(200);
        response.end(blob);
      });
      return;
    } 
       
    console.log(path);
    response.writeHead(404);
    response.end();
});
server.listen(8080, function() {
    console.log((new Date()) + ' Server is listening on port 8080');
});

wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // put logic here to detect whether the specified origin is allowed.
  return true;
}

wsServer.on('request', function(request) {
    if (!originIsAllowed(request.origin)) {
      // Make sure we only accept requests from an allowed origin
      request.reject();
      console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
      return;
    }
    if (request.httpRequest.url[0]!="/") {
      request.reject();
      console.log("Invalid connection URL "+request.httpRequest.url);
      return;
    }
    var device = request.httpRequest.url.substr(1);
    Espruino.Core.Serial.open(device, function(ok) {
      if (!ok) {
        request.reject();
        console.log("Failed to open port");
        return;
      }
      connection = request.accept('serial', request.origin);
      console.log((new Date()) + ' Connection accepted.');
      connection.on('message', function(message) {
        console.log('Received Message: ' + message.type + " - " + message.utf8Data);
        Espruino.Core.Serial.write(message.utf8Data);
      });
      connection.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Peer disconnected.');
        Espruino.Core.Serial.close();
        connection = undefined;
      });
    }, function() {
      if (connection) connection.close();
      console.log(device + "Disconnected");
      connection = undefined;
    });
});