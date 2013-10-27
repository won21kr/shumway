/* -*- Mode: js; js-indent-level: 2; indent-tabs-mode: nil; tab-width: 2 -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
 * Copyright 2013 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*global SWF, renderStage, rgbaObjToStr, ShumwayKeyboardListener */

SWF.embed = function(file, doc, container, options) {
  var canvas = doc.createElement('canvas');
  var ctx = canvas.getContext('2d');
  var loader = new flash.display.Loader();
  var loaderInfo = loader.contentLoaderInfo;
  var stage = new flash.display.Stage();

  stage._loader = loader;
  loaderInfo._parameters = options.movieParams;
  loaderInfo._url = options.url || (typeof file === 'string' ? file : null);
  loaderInfo._loaderURL = options.loaderURL || loaderInfo._url;

  // HACK support of HiDPI displays
  var pixelRatio = 'devicePixelRatio' in window ? window.devicePixelRatio : 1;
  var canvasHolder = null;
  canvas._pixelRatio = pixelRatio;
  if (pixelRatio > 1) {
    var cssScale = 'scale(' + (1 / pixelRatio) + ', ' + (1 / pixelRatio) + ')';
    canvas.setAttribute('style', '-moz-transform: ' + cssScale + ';' +
                                 '-webkit-transform: ' + cssScale + ';' +
                                 'transform: ' + cssScale + ';' +
                                 '-moz-transform-origin: 0% 0%;' +
                                 '-webkit-transform-origin: 0% 0%;' +
                                 'transform-origin: 0% 0%;');
    canvasHolder = doc.createElement('div');
    canvasHolder.setAttribute('style', 'display: inline-block; overflow: hidden;');
    canvasHolder.appendChild(canvas);
  }
  stage._contentsScaleFactor = pixelRatio;

  loader._parent = stage;
  loader._stage = stage;

  function fitCanvas(container, canvas) {
    if (canvasHolder) {
      canvasHolder.style.width = container.clientWidth + 'px';
      canvasHolder.style.height = container.clientHeight + 'px';
    }
    canvas.width = container.clientWidth * pixelRatio;
    canvas.height = container.clientHeight * pixelRatio;
    stage._invalid = true;
  }

  loaderInfo._addEventListener('init', function () {
    if (container.clientHeight) {
      fitCanvas(container, canvas);
      window.addEventListener('resize', function () {
        fitCanvas(container, canvas);
      });
    } else {
      if (canvasHolder) {
        canvasHolder.style.width = (stage._stageWidth / 20) + 'px';
        canvasHolder.style.height = (stage._stageHeight / 20) + 'px';
      }
      canvas.width = stage._stageWidth * pixelRatio / 20;
      canvas.height = stage._stageHeight * pixelRatio / 20;
    }

    container.setAttribute("style", "position: relative");

    canvas.addEventListener('click', function () {
      ShumwayKeyboardListener.focus = stage;

      stage._mouseTarget._dispatchEvent('click');
    });
    canvas.addEventListener('dblclick', function () {
      if (stage._mouseTarget._doubleClickEnabled) {
        stage._mouseTarget._dispatchEvent('doubleClick');
      }
    });
    canvas.addEventListener('mousedown', function () {
      if (stage._mouseTarget._buttonMode) {
        stage._mouseTarget._gotoButtonState('down');
      }
      stage._mouseTarget._dispatchEvent('mouseDown');
    });
    canvas.addEventListener('mousemove', function (domEvt) {
      var node = this;
      var left = 0;
      var top = 0;
      if (node.offsetParent) {
        do {
          left += node.offsetLeft;
          top += node.offsetTop;
        } while ((node = node.offsetParent));
      }

      var m = stage._concatenatedTransform;
      var mouseX = ((domEvt.pageX - left) * pixelRatio - m.tx) / m.a;
      var mouseY = ((domEvt.pageY - top) * pixelRatio - m.ty) / m.d;

      if (mouseX !== stage._mouseX || mouseY !== stage._mouseY) {
        stage._mouseMoved = true;
        stage._mouseX = mouseX * 20;
        stage._mouseY = mouseY * 20;
      }
    });
    canvas.addEventListener('mouseup', function () {
      if (stage._mouseTarget._buttonMode) {
        stage._mouseTarget._gotoButtonState('over');
      }
      stage._mouseTarget._dispatchEvent('mouseUp');
    });
    canvas.addEventListener('mouseover', function () {
      stage._mouseMoved = true;
      stage._mouseOver = true;
    });
    canvas.addEventListener('mouseout', function () {
      stage._mouseMoved = true;
      stage._mouseOver = false;
    });

    var bgcolor = loaderInfo._backgroundColor;
    if (options.objectParams) {
      var m;
      if (options.objectParams.bgcolor &&
          (m = /#([0-9A-F]{6})/i.exec(options.objectParams.bgcolor))) {
        var hexColor = parseInt(m[1], 16);
        bgcolor = {
          red: (hexColor >> 16) & 255,
          green: (hexColor >> 8) & 255,
          blue: hexColor & 255,
          alpha: 255
        };
      }
      if (options.objectParams.wmode === 'transparent') {
        bgcolor = {red: 0, green: 0, blue: 0, alpha: 0};
      }
    }
    stage._color = bgcolor;

    ctx.fillStyle = rgbaObjToStr(bgcolor);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var root = loader._content;

    stage._children[0] = root;

    root._dispatchEvent("added");
    root._dispatchEvent("addedToStage");

    container.appendChild(canvasHolder || canvas);

    if (options.onStageInitialized) {
      options.onStageInitialized(stage);
    }

    renderStage(stage, ctx, options);
  });

  if (options.onComplete) {
    loaderInfo._addEventListener("complete", function () {
      options.onComplete();
    });
  }

  loader._load(typeof file === 'string' ? new flash.net.URLRequest(file) : file);

  return loader;
};
