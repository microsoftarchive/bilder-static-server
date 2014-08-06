module.exports = function(grunt) {

  'use strict';

  var connect = require('connect');
  var tinylr = require('tiny-lr');
  var wsClient = require('tiny-lr/lib/client');
  var serveStatic = require('serve-static');
  var favicon = require('serve-favicon');

  var http = require('http');
  var fs = require('fs');
  var path = require('path');

  function precompileRegExps (map) {
    var keys = [];
    Object.keys(map).forEach(function (rule) {
      var regexp = new RegExp('^\\/' + rule + '($|\\?)');
      map[regexp] = map[rule];
      delete map[rule];
      keys.push(regexp);
    });
    return keys;
  }

  function findMatch (keys, url) {
    var regexp, matches;
    for (var i = 0, l = keys.length; i < l; i++ ) {
      regexp = keys[i];
      matches = url.match(regexp);

      // found a match
      if(matches && matches.length) {
        return {
          'matches': matches,
          'regexp': regexp
        };
      }
    }
  }

  function customMiddleware (options, rewrite_rules, rewrite_keys, template_rules, template_keys) {

    return function (req, resp, next) {

      // Skip requests other than GET & HEAD
      if ('GET' !== req.method && 'HEAD' !== req.method) {
        return next();
      }

      // URL, to perform magic on
      var url = req.url;
      var result;

      // If the requested URL is a template, render it & return
      result = findMatch(template_keys, url);
      if(result && result.matches) {
        var fn = template_rules[result.regexp];
        if(typeof fn === 'function') {
          resp.end(fn.call());
          return;
        }
      }

      // Loop through the rules to see if any match
      var replacement;
      result = findMatch(rewrite_keys, url);
      if(result && result.matches) {
        replacement = rewrite_rules[result.regexp];
        result.matches.forEach(function (match, index) {
          replacement = replacement.replace(new RegExp('\\$' + index, 'g'), match);
        });
      }

      // No caching
      resp.setHeader('Cache-Control', 'no-cache, no-store, max-age=0');

      // rewritten url
      if(replacement) {
        req.url = path.join('/', replacement).replace(/\/+/g, '/');
      }
      // everything else
      else {
        req.url = path.join('/', options.base, url);
      }

      next();
    };
  }

  var server = tinylr();
  wsClient.prototype.custom = function(data) {
    var self = this;
    var clients = Object.keys(server.clients);
    clients.forEach(function(id) {
      // don't send the event back to the original sender
      var client = server.clients[id];
      if(self !== client) {
        client.send(data);
      }
    });
  };

  function onConnect () {
    grunt.event.on('asset:compiled', function(type, file, name) {
      var clients = Object.keys(server.clients);
      clients.forEach(function(id) {
        var client = server.clients[id];
        client.send({
          'command': 'reload',
          'path': type + ':' + name
        });
      });
    });
    grunt.log.ok('Livereload server started at port ', server.port);
  }

  function startLiveReload (port) {
    server.listen(port, onConnect);
  }

  function ServerTask() {

    // Default options
    var options = this.options({
      'port': 5000,
      'lrPort': 35729,
      'root': '.',
      'base': 'public',
      'favicon': 'images/favicon.ico',
      'templates': {},
      'rewrite': {}
    });

    // Connect requires the root path to be absolute.
    options.root = path.resolve(options.root);
    grunt.log.debug('app root', options.root);

    // Precompile rewrite rules
    var rewrite_rules = options.rewrite;
    var rewrite_keys = precompileRegExps(rewrite_rules);

    //  & template rules
    var template_rules = options.templates;
    var template_keys = precompileRegExps(template_rules);

    // It's an async task
    var done = this.async();

    // Init the server
    var server = connect();

    // Favicon everything
    var faviconPath = path.join(options.base, options.favicon);
    server.use(favicon(faviconPath));

    // custom middleware for re-routing
    server.use(customMiddleware (options, rewrite_rules, rewrite_keys, template_rules, template_keys));

    // use connect's static middleware
    serveStatic.mime.define(options.mime || {});
    server.use(serveStatic(options.root));

    grunt.log.debug('middlewares setup');

    // Once server is started
    var httpServer = http.createServer(server);
    httpServer.on('listening', function() {

      var isStandAlone = (grunt.cli.tasks.length === 1 && grunt.cli.tasks[0] === 'static');
      var address = httpServer.address();
      var host = address.host || '0.0.0.0';

      grunt.log.ok('Started static server on http://' + host + ':' + address.port + '', isStandAlone ? ' in standalone mode' : '');

      startLiveReload(options.lrPort);

      // Keepalive in standalone mode
      if(!isStandAlone) {
        done();
      }
    })

    // Die if the static server fails to start up
    .on('error', function(err) {
      if (err.code === 'EADDRINUSE') {
        grunt.fatal('Port ' + options.port + ' is already in use by another process.');
      } else {
        grunt.fatal(err);
      }
    });

    // Start listening
    httpServer.listen(options.port);
  }

  grunt.registerTask('static', 'Connect based static server with regexp based rewrite support', ServerTask);
};