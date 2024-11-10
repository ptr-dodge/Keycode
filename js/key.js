const sampleImage = "./img/sample.jfif";

const xfrm = {
  pixelsPerInch: 360,
  vw: 700,
  vh: 660,

  // position at most recent mouse-down
  mdx: 0,
  mdy: 0,
  mdt: 0,

  // most recent mouse move or down position
  mx: 0,
  my: 0,

  // most recent touch positions and touch down positions, per id
  t: {},
  td: {},

  // viewport zoom and pan
  vdx: 0,
  vdy: 0,
  va: 1,

  // rectangular photograph maps to this quad
  pa: Vector2(0, 0),
  pb: Vector2(0, 0),
  pc: Vector2(0, 0),
  pd: Vector2(0, 0),
  // hg is homography from photo bitmap coords to screen (rectified) coords, ihg is inverse
  hg: [],
  ihg: [],
};
var renderer,
  toDispose,
  photoTexture,
  photoMaterial,
  photoBitmap,
  photoWidth,
  photoHeight;
var cv = [];
var manualDepths = {};

function bitting(mfgr, pins) {
  var spacings = [],
    depths = [],
    width = "";
  if (mfgr === "kw") {
    spacings = [0.247, 0.397, 0.547, 0.697, 0.847, 0.997];
    depths = ["unused", 0.329, 0.306, 0.283, 0.26, 0.237, 0.214, 0.191];
    width = "0.335";
  } else if (mfgr === "sc") {
    spacings = [0.231, 0.3872, 0.5434, 0.6996, 0.8558, 1.012];
    depths = [0.335, 0.32, 0.305, 0.29, 0.275, 0.26, 0.245, 0.23, 0.215, 0.2];
    width = "0.343";
  }

  spacings = spacings.slice(0, pins);

  $("#bitting_spacings").val(
    spacings
      .map(function (x) {
        return x.toFixed(4);
      })
      .join(", ")
  );
  $("#bitting_width").val(width);
  $("#bitting_depths").val(
    depths
      .map(function (x) {
        return x === "unused" ? x : x.toFixed(3);
      })
      .join(", ")
  );
}

function loadImage(uri, sample) {
  $("#photo")[0].onload = function () {
    var mgr = new THREE.LoadingManager();
    var ldr = new THREE.TextureLoader(mgr);
    ldr.load(
      uri,
      function (texture) {
        texture.minFilter = THREE.LinearFilter;
        photoTexture = texture;

        photoMaterial = new THREE.MeshBasicMaterial({
          map: photoTexture,
          depthTest: false,
          side: THREE.DoubleSide,
        });

        if (!sample) resetHomography();

        manualDepths = {};

        var img = $("#photo")[0],
          canvas = $("#photoc")[0];
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        var imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
        photoBitmap = imgd.data;
        photoWidth = canvas.width;
        photoHeight = canvas.height;
        getKeyCode();

        if (!sample) {
          $("#modal_outer").css("display", "none");
          $("#modal_ok").css("display", "inline-block");
        }

        $("#tab_align").click();
      },
      undefined,
      function (err) {
        console.log("texture loading error");
      }
    );
  };

  if (sample) {
    modalMessage(
      "Loaded sample image. The bitting has been set to KW1.<br><br>This image has already been aligned to the red and blue guides. If you select the Align tab, then you'll see the correct code.<br><br>When you load your own image, you'll need to align it to the guides by hand. Try moving and rotating the sample image. Watch how the green detected cuts and the code change, to learn how the tools work.<br><br>If the detected edges of the cuts are wrong, then click or tap to place manually, again to clear."
    );
  } else {
    $("#modal_inner").html("Loading image...");
    $("#modal_ok").css("display", "none");
    $("#modal_outer").css("display", "flex");
  }

  $("#photo").attr("src", uri);
}

function loadSampleImage() {
  bitting("kw", 5);
  loadImage(sampleImage, true);

  xfrm.hg = [
    0.5018518300223738, 0.03280486662499481, 0.008149327540922235,
    -0.019599621583268556, 0.8399745004999475, 0.20262731136053902,
    1.8410231821756825e-18, 3.6041222243318587e-19, 0.0017423903114348802,
  ];

  xfrm.ihg = [
    0.003369933236284373, -0.00013161138854292278, -0.00045605621394176343,
    0.00007863264438711157, 0.0020134029791094104, -0.23451188452733207,
    -3.5210555230054996e-18, -2.1255039632640669e-19, 0.9721052074142724,
  ];

  xfrm.pa = Vector2(-1, -1).hg();
  xfrm.pb = Vector2(-1, 1).hg();
  xfrm.pc = Vector2(1, 1).hg();
  xfrm.pd = Vector2(1, -1).hg();

  solveForHomography();
  resetViewport();
}

function loadImageFromFile(ev) {
  var fr = new FileReader();
  fr.onload = function () {
    var dataUri = fr.result;
    loadImage(dataUri, false);
  };
  fr.readAsDataURL(ev.target.files[0]);
}

function normalizeHomography() {
  ["hg", "ihg"].forEach(function (p) {
    var sum = 0;
    xfrm[p].forEach(function (x) {
      sum += x * x;
    });
    sum = Math.sqrt(sum);
    xfrm[p] = xfrm[p].map(function (x) {
      return x / sum;
    });
  });
}

function solveForHomography() {
  function check(A, x) {
    var i,
      j,
      norm2 = 0;
    console.log("A*x=");
    for (i = 0; i < 8; i++) {
      var sum = 0;
      for (j = 0; j < 9; j++) {
        sum += A[i][j] * x[j];
      }
      console.log("  " + sum);
      norm2 += sum * sum;
    }
    console.log("|A*x|^2 = " + norm2);
  }

  function solve(ins, outs, hg) {
    var i,
      j,
      jj,
      A = [],
      b = [];

    // xout = (h0*xin + h1*yin + h2)/(h6*xin + h7*yin + 1)
    // h6*xout*xin + h7*xout*yin + h8*xout = h0*xin + h1*yin + h2
    //
    // yout = (h3*xin + h4*yin + h5)/(h6*xin + h7*yin + 1)
    // h6*yout*xin + h7*yout*yin + h8*yout = h3*xin + h4*yin + h5
    //
    for (i = 0; i < 8; i += 2) {
      var pin = ins[i / 2],
        pout = outs[i / 2];

      A[i] = [
        pin.x,
        pin.y,
        1,
        0,
        0,
        0,
        -pout.x * pin.x,
        -pout.x * pin.y,
        -pout.x,
      ];
      A[i + 1] = [
        0,
        0,
        0,
        pin.x,
        pin.y,
        1,
        -pout.y * pin.x,
        -pout.y * pin.y,
        -pout.y,
      ];

      b[i] = [pout.x];
      b[i + 1] = [pout.y];
    }

    var x = hg;

    // minimize norm(A*x) by coordinate descent
    for (var iter = 0; iter < 10; iter++) {
      for (j = 0; j < 9; j++) {
        // cost has form
        //    (k_1 + A_1j*x_j)^2 + (k_2 + A_2j*x_j)^2 + ...
        // with k_... constant from other x, minimized when derivative wrt x_j is zero so
        //    2*A_1j*(k1 + A_1j*x_j) + 2*(A_2j*(k2 + A_2j*x_j)^2 + ... = 0
        var num = 0,
          den = 0;
        for (i = 0; i < 8; i++) {
          den += A[i][j] * A[i][j];
          var sum = 0;
          for (jj = 0; jj < 9; jj++) {
            if (jj == j) continue;
            sum += A[i][jj] * x[jj];
          }
          num += A[i][j] * sum;
        }
        x[j] = -num / den;
      }
    }
  }

  var outs = [xfrm.pa, xfrm.pb, xfrm.pc, xfrm.pd],
    ins = [Vector2(-1, -1), Vector2(-1, 1), Vector2(1, 1), Vector2(1, -1)];

  solve(ins, outs, xfrm.hg);
  solve(outs, ins, xfrm.ihg);

  normalizeHomography();
  getKeyCode();
}

function resetHomography() {
  var img = $("#photo")[0],
    r = img.naturalWidth / img.naturalHeight,
    mx = xfrm.vw / 2,
    my = xfrm.vh / 2;
  if (r > mx / my) {
    my = mx / r;
  } else {
    mx = my * r;
  }
  xfrm.pa = Vector2(-mx, -my);
  xfrm.pb = Vector2(-mx, my);
  xfrm.pc = Vector2(mx, my);
  xfrm.pd = Vector2(mx, -my);

  xfrm.hg = [mx, 0, 0, 0, my, 0, 0, 0, 1];
  xfrm.ihg = [1 / mx, 0, 0, 0, 1 / my, 0, 0, 0, 1];
  normalizeHomography();

  resetViewport();
}

function Vector2(x, y) {
  return {
    x: x,
    y: y,
    plus: function (b) {
      return Vector2(this.x + b.x, this.y + b.y);
    },
    minus: function (b) {
      return Vector2(this.x - b.x, this.y - b.y);
    },
    scaledBy: function (k) {
      return Vector2(this.x * k, this.y * k);
    },
    lengthSquared: function () {
      return x * x + y * y;
    },
    length: function () {
      return Math.sqrt(x * x + y * y);
    },
    rotatedAboutOrigin: function (theta) {
      var c = Math.cos(theta),
        s = Math.sin(theta);
      return Vector2(c * x + s * y, -s * x + c * y);
    },
    TV3: function (k) {
      return new THREE.Vector3(this.x, this.y, 1);
    },
    afterHomography: function (hg) {
      var denom = hg[6] * x + hg[7] * y + hg[8];

      return Vector2(
        (hg[0] * x + hg[1] * y + hg[2]) / denom,
        (hg[3] * x + hg[4] * y + hg[5]) / denom
      );
    },
    hg: function () {
      return this.afterHomography(xfrm.hg);
    },
    ihg: function () {
      return this.afterHomography(xfrm.ihg);
    },
    toString: function () {
      return "(" + x.toFixed(6) + ", " + y.toFixed(6) + ")";
    },
  };
}

function parseBittings() {
  var b = {};
  b.width = parseFloat($("#bitting_width").val());
  b.spacings = $("#bitting_spacings")
    .val()
    .split(",")
    .map(function (x) {
      return parseFloat(x);
    });
  b.depths = $("#bitting_depths")
    .val()
    .split(",")
    .map(function (x) {
      return parseFloat(x);
    });

  if (isNaN(b.width) || b.spacings.length < 2 || b.depths < 2) {
    return undefined;
  }

  b.maxsp = 0;
  b.minsp = 100;
  b.spacings.forEach(function (y) {
    if (isNaN(y)) return;
    if (y > b.maxsp) b.maxsp = y;
    if (y < b.minsp) b.minsp = y;
  });
  b.shoulder = b.maxsp / 2;
  b.guide = 0.1;
  b.guideLength = b.maxsp + 0.3;
  return b;
}

function plotColorChannels(digit) {
  var sp = cv[digit];
  if (!sp) return;

  $("#code td").removeClass("sel");
  $("#code tr td:nth-child(" + (digit + 2).toString() + ")").addClass("sel");

  var b = parseBittings();

  var canvas = $("#graph")[0],
    ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var maxDepth = 100;
  b.depths.forEach(function (d) {
    if (!isNaN(d) && d < maxDepth) maxDepth = d; // max depth is min remaining width
  });

  var xmax = sp.x[sp.x.length - 1],
    xmin = sp.x[0];

  mapX = function (x) {
    return ((x - xmin) * 700) / (xmax - xmin);
  };
  mapY = function (y) {
    return 370 - 1.3 * y;
  };

  ctx.strokeStyle = "#888";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, mapY(0));
  ctx.lineTo(canvas.width, mapY(0));
  ctx.moveTo(0, mapY(255));
  ctx.lineTo(canvas.width, mapY(255));
  ctx.stroke();

  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mapY(128));
  ctx.lineTo(canvas.width, mapY(128));
  b.depths.forEach(function (x) {
    if (isNaN(x)) return;
    x = -b.width / 2 + x;

    ctx.moveTo(mapX(x), 20);
    ctx.lineTo(mapX(x), canvas.height - 25);
  });
  ctx.stroke();

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mapX(-b.width / 2 + sp.xedge), mapY(-10));
  ctx.lineTo(mapX(-b.width / 2 + sp.xedge), mapY(265));
  ctx.stroke();

  for (var i = 0; i < b.depths.length; i++) {
    var x = b.depths[i];
    if (isNaN(x)) continue;
    x = -b.width / 2 + x;

    ctx.fillStyle = "black";
    ctx.font = "22px sans-serif";
    var text = i.toString(),
      tw = ctx.measureText(text).width;
    ctx.fillText(text, mapX(x) - tw / 2, canvas.height);
  }

  ["red", "green", "blue", "disc"].forEach(function (trace) {
    if (trace == "disc") {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "black";
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = trace;
    }
    ctx.beginPath();

    var d = sp[trace],
      dx = sp.x;

    for (var i = 0; i < sp.n; i++) {
      var x = mapX(dx[i]),
        y = mapY(d[i]);
      if (i == 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  });
}

function getKeyCode() {
  var pix = photoBitmap;
  if (!photoBitmap) return;

  /*    var img = $('#photo')[0], canvas = $('#photoc')[0];
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
    photoBitmap = imgd.data;
    pix = photoBitmap;
    photoWidth = canvas.width;
    photoHeight = canvas.height; */

  var b = parseBittings();

  var mind = 100;
  b.depths.forEach(function (d) {
    if (isNaN(d)) return;
    if (d < mind) mind = d;
  });

  cv = [];

  b.spacings.slice(0).forEach(function (ysp) {
    if (isNaN(ysp)) return;

    var y = b.shoulder - ysp;
    var pr = [],
      pg = [],
      pb = [],
      px = [];

    // easy to get false edges off profile of key, so keep region tight on left
    var step = 0.001,
      beyond = 0.08,
      slop = 0.015;
    for (
      var x = -b.width / 2 + mind - slop;
      x < b.width / 2 + beyond;
      x += step
    ) {
      var tr = 0,
        tg = 0,
        tb = 0;
      [-0.002, -0.001, 0, 0.001, 0.002].forEach(function (dy) {
        var pt = Vector2(x * xfrm.pixelsPerInch, (y + dy) * xfrm.pixelsPerInch),
          bpt = pt.ihg();
        var bx = (((bpt.x + 1) / 2) * photoWidth) | 0,
          by = (((-bpt.y + 1) / 2) * photoHeight) | 0;

        var i = (photoWidth * by + bx) * 4;
        tr += pix[i + 0];
        tg += pix[i + 1];
        tb += pix[i + 2];

        /*                pix[i+0] = 0;
                pix[i+1] = 0xff;
                pix[i+2] = 0; */
      });

      px.push(x);
      pr.push(tr / 5);
      pg.push(tg / 5);
      pb.push(tb / 5);
    }

    // first, look at difference between pixel and average of all to right
    var disc = [],
      rightN = 0,
      rightR = 0,
      rightG = 0,
      rightB = 0;
    for (i = pr.length - 1; i >= 1; i--) {
      rightR += pr[i];
      rightG += pg[i];
      rightB += pb[i];
      rightN++;

      var rar = rightR / rightN,
        rag = rightG / rightN,
        rab = rightB / rightN,
        dr = rar - pr[i - 1],
        dg = rag - pr[i - 1],
        db = rab - pr[i - 1],
        dd = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3; // vaguely perceptual weight

      disc[i] = dd;
    }
    disc[0] = disc[1];

    // high-pass filter to find edge
    var hpf = [0.4, 0.7, 1, -1, -0.7, -0.4],
      hpfd = [0, 0, 0];
    for (i = 3; i < disc.length - 2; i++) {
      var sum = 0;
      for (j = 0; j < 6; j++) {
        sum += hpf[j] * disc[i + j - 3];
      }
      sum += 0;
      hpfd.push(sum);
    }
    hpfd.push(0, 0);

    // look at average noise a little beyond key
    var maxNoise = 6,
      discmaxi = disc.length - 1,
      margin = ((beyond - slop) / step) | 0;
    for (i = hpfd.length - 1; i >= hpfd.length - margin; i--) {
      if (hpfd[i] > maxNoise) maxNoise = hpfd[i];
    }
    for (i = hpfd.length - (margin + 1); i >= 0; i--) {
      if (hpfd[i] > maxNoise * 3) {
        var max = hpfd[i];
        // find the peak, allowing for a bit of non-monotonicity due to noise
        while (i >= 1 && hpfd[i - 1] > max * 0.7) {
          max = Math.max(max, hpfd[i - 1]);
          i--;
        }
        discmaxi = i + 1;
        break;
      }
    }

    //        disc = [ ]; hpfd.forEach(function(v) { disc.push(v+128); });

    var xedge = px[discmaxi],
      code = "?",
      dxedge = 100;
    xedge = b.width / 2 + xedge;

    var manual = false;
    if (ysp in manualDepths) {
      manual = true;
      xedge = manualDepths[ysp];
    }

    for (i = 0; i < b.depths.length; i++) {
      var x = b.depths[i];
      if (isNaN(x)) continue;
      var dx = x - xedge;
      if (Math.abs(dx) < Math.abs(dxedge)) {
        code = i.toString();
        dxedge = dx;
      }
    }

    cv.push({
      red: pr,
      green: pg,
      blue: pb,
      disc: disc,
      x: px,
      n: pr.length,
      xedge: xedge,
      code: code,
      xerror: dxedge,
      manual: manual,
      y: y,
    });
  });

  //    ctx.putImageData(imgd, 0, 0);
}

function makeKeyCodeHtml() {
  $("#code").html("");

  var table = $("#code"),
    tra = $("<tr>"),
    trb = $("<tr>"),
    trc = $("<tr>"),
    i = 0;
  tra.append($("<th>").text("code"));
  trb.append($("<th>").text("error"));
  trc.append($("<th>"));
  cv.forEach(function (sp) {
    var axe = Math.abs(sp.xerror),
      code = sp.code,
      xe = sp.xerror.toFixed(3),
      cl;
    if (sp.xerror > 0) xe = "+" + xe;

    if (axe < 0.002) {
      cl = "good";
    } else if (axe < 0.005) {
      cl = "maybe";
    } else if (axe < 0.02) {
      cl = "bad";
    } else {
      cl = "bad";
      xe = "???";
      code = "?";
    }

    var tda = $("<td>").text(code),
      tdb = $("<td>").text(xe).addClass(cl),
      tdc = $("<td>").html(sp.manual ? "&#128274;" : "");

    tda.add(tdb).hover(
      function () {
        tda.add(tdb).addClass("hl");
      },
      function () {
        tda.add(tdb).removeClass("hl");
      }
    );

    var saveI = i;
    tda.add(tdb).click(function () {
      plotColorChannels(saveI);
    });

    tra.append(tda);
    trb.append(tdb);
    trc.append(tdc);

    i++;
  });
  table.append(tra);
  table.append(trb);
  table.append(trc);

  plotColorChannels(0);
}

var pool;

function render() {
  if (!renderer) return;
  var b = parseBittings();
  if (!b) return;

  if (!pool) {
    pool = {};
    pool.m = { l: {}, q: {} };

    [
      ["r", 0xff0000],
      ["g", 0x226666],
      ["y", 0x00ff00],
      ["b", 0x0000ff],
      ["k", 0x888888],
    ].forEach(function (c) {
      pool.m.l[c[0]] = new THREE.MeshBasicMaterial({
        color: c[1],
        opacity: 0.9,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      });
    });

    for (var i = 0; i < 4; i++) {
      pool.m.q[i] = new THREE.MeshBasicMaterial({
        color: [0x00ffff, 0xff00ff, 0xffff00, 0x00ff00][i],
        opacity: 0.2,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      });
    }

    var camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.z = 5;
    pool.c = camera;

    pool.s = new THREE.Scene();
  }

  pool.g = {};
  pool.g.l = {
    r: new THREE.Geometry(),
    g: new THREE.Geometry(),
    y: new THREE.Geometry(),
    b: new THREE.Geometry(),
    k: new THREE.Geometry(),
  };
  pool.g.p = new THREE.Geometry();

  pool.g.q = {};
  for (i = 0; i < 4; i++) {
    pool.g.q[i] = new THREE.Geometry();
  }

  if (pool.s.children !== undefined) {
    while (pool.s.children.length > 0) {
      pool.s.remove(pool.s.children[0]);
    }
  }

  var cpme = pool.c.projectionMatrix.elements;

  var ax = (xfrm.va * 2) / xfrm.vw,
    ay = (xfrm.va * 2) / xfrm.vh;

  var A = [
    ax,
    0,
    0,
    0,
    0,
    ay,
    0,
    0,
    0,
    0,
    ax,
    0,
    -xfrm.vdx * ax,
    xfrm.vdy * ay,
    0,
    1,
  ];

  for (var i = 0; i < 16; i++) cpme[i] = A[i];

  var scene = pool.s,
    lgs = pool.g.l;

  function line(x0, y0, x1, y1, w, color) {
    var p0 = Vector2(x0, y0),
      p1 = Vector2(x1, y1),
      dp = p1.minus(p0),
      l = dp.length();

    // get fatter as we zoom in, but not too fat
    dp = dp.scaledBy(w / (Math.sqrt(xfrm.va) * l * 2));

    var n = Vector2(-dp.y, dp.x),
      a = p0.plus(n),
      b = p1.plus(n),
      c = p1.minus(n),
      d = p0.minus(n);

    var lg = lgs[color],
      i = lg.vertices.length;
    lg.vertices.push(a.TV3(), b.TV3(), c.TV3());
    lg.faces.push(new THREE.Face3(i + 0, i + 1, i + 2));
    lg.vertices.push(a.TV3(), c.TV3(), d.TV3());
    lg.faces.push(new THREE.Face3(i + 3, i + 4, i + 5));
  }
  function inchLine(x0, y0, x1, y1, w, c) {
    var a = xfrm.pixelsPerInch;
    line(x0 * a, y0 * a, x1 * a, y1 * a, w, c);
  }

  inchLine(
    -b.width / 2,
    b.shoulder,
    -b.width / 2 - b.guide,
    b.shoulder,
    2,
    "b"
  );
  inchLine(b.width / 2, b.shoulder, b.width / 2 + b.guide, b.shoulder, 2, "b");
  inchLine(
    b.width / 2 + b.guide,
    b.shoulder,
    b.width / 2 + b.guide,
    b.shoulder + 0.2,
    2,
    "k"
  );
  inchLine(
    -b.width / 2 - b.guide,
    b.shoulder,
    -b.width / 2 - b.guide,
    b.shoulder + 0.2,
    2,
    "k"
  );

  inchLine(
    -b.width / 2,
    b.shoulder,
    -b.width / 2,
    b.shoulder - b.guideLength,
    2,
    "r"
  );
  inchLine(
    b.width / 2,
    b.shoulder,
    b.width / 2,
    b.shoulder - b.guideLength + 0.2,
    2,
    "r"
  );
  inchLine(
    b.width / 2,
    b.shoulder - b.guideLength + 0.2,
    b.width / 2 - 0.03,
    b.shoulder - b.guideLength + 0.1,
    2,
    "k"
  );

  b.spacings.forEach(function (y) {
    if (isNaN(y)) return;
    inchLine(
      -b.width / 2,
      b.shoulder - y,
      b.width / 2 + 0.5,
      b.shoulder - y,
      1,
      "g"
    );
  });

  b.depths.forEach(function (x) {
    if (isNaN(x)) return;
    inchLine(
      -b.width / 2 + x,
      b.shoulder - b.minsp + 0.1,
      -b.width / 2 + x,
      b.shoulder - b.maxsp - 0.1,
      1,
      "g"
    );
  });

  cv.forEach(function (sp) {
    var x = -b.width / 2 + sp.xedge;
    inchLine(x, sp.y - 0.03, x, sp.y + 0.03, 1, "y");
    if (sp.manual) {
      var o = Vector2(x - 0.04, sp.y + 0.02),
        l = 0.03,
        ly = 0.02,
        r = 0.013;
      function il(x0, y0, x1, y1) {
        inchLine(x0 + o.x, y0 + o.y, x1 + o.x, y1 + o.y, 1, "y");
      }

      il(0, 0, 0, ly);
      il(0, ly, l, ly);
      il(l, ly, l, 0);
      il(l, 0, 0, 0);

      var c = [1, 1, 0.8660254, 0.5, 0, -0.5, -0.8660254, -1, -1],
        s = [-0.3, 0, 0.5, 0.8660254, 1, 0.8660254, 0.5, 0, -0.3];

      o.y += ly + 0.3 * r;
      o.x += l / 2;
      for (var i = 1; i < c.length; i++) {
        il(r * c[i - 1], r * s[i - 1], r * c[i], r * s[i]);
      }
    }
  });

  // the photo; do a grid of quads, support CanvasRenderer and debug my homography
  var pg = pool.g.p;
  pg.faceVertexUvs[0] = [];
  var n = 10,
    c = 0;
  for (var i = 0; i < n; i++) {
    for (var j = 0; j < n; j++) {
      var u0 = i / n,
        u1 = (i + 1) / n,
        v0 = j / n,
        v1 = (j + 1) / n;

      var qa = Vector2(u0 * 2 - 1, v0 * 2 - 1).hg(),
        qb = Vector2(u0 * 2 - 1, v1 * 2 - 1).hg(),
        qc = Vector2(u1 * 2 - 1, v1 * 2 - 1).hg(),
        qd = Vector2(u1 * 2 - 1, v0 * 2 - 1).hg();

      pg.vertices.push(qa.TV3(), qb.TV3(), qc.TV3());
      pg.faces.push(new THREE.Face3(c++, c++, c++));
      pg.vertices.push(qa.TV3(), qc.TV3(), qd.TV3());
      pg.faces.push(new THREE.Face3(c++, c++, c++));

      pg.faceVertexUvs[0].push([
        new THREE.Vector2(u0, v0),
        new THREE.Vector2(u0, v1),
        new THREE.Vector2(u1, v1),
      ]);
      pg.faceVertexUvs[0].push([
        new THREE.Vector2(u0, v0),
        new THREE.Vector2(u1, v1),
        new THREE.Vector2(u1, v0),
      ]);
    }
  }
  scene.add(new THREE.Mesh(pg, photoMaterial));

  // the lines
  for (var c in lgs) {
    scene.add(new THREE.Mesh(lgs[c], pool.m.l[c]));
  }

  if (
    document.querySelector("input[name=manip_mouse]:checked")?.value ===
    "free_xfrm"
  ) {
    for (var i = 0; i < 4; i++) {
      var xs = i & 1 ? 1 : -1,
        ys = i & 2 ? 1 : -1,
        m = 600 / xfrm.va;
      var a = Vector2(xfrm.vdx, -xfrm.vdy);
      b = a.plus(Vector2(0, m * ys));
      c = b.plus(Vector2(m * xs, 0));
      d = a.plus(Vector2(m * xs, 0));

      var tg = pool.g.q[i];
      tg.vertices.push(a.TV3(), b.TV3(), c.TV3());
      tg.faces.push(new THREE.Face3(0, 1, 2));
      tg.vertices.push(a.TV3(), c.TV3(), d.TV3());
      tg.faces.push(new THREE.Face3(3, 4, 5));

      scene.add(new THREE.Mesh(tg, pool.m.q[i]));
    }
  }

  renderer.render(scene, pool.c);

  for (var c in pool.g.l) {
    pool.g.l[c].dispose();
  }
  for (var c in pool.g.q) {
    pool.g.q[c].dispose();
  }
  pool.g.p.dispose();
}

function fromMouse(x, y) {
  if (typeof x === "object") {
    y = x.y;
    x = x.x;
  }

  var r = Vector2(x, -y).minus(Vector2(xfrm.vw / 2, -xfrm.vh / 2));
  r = r.scaledBy(1 / xfrm.va);
  return r.minus(Vector2(-xfrm.vdx, xfrm.vdy));
}

function onePointMoveInteraction(x, y, xp, yp, xd, yd) {
  var dx = xp - x,
    dy = yp - y;

  switch ($("input[name=manip_mouse]:checked").val()) {
    case "viewport":
      xfrm.vdx += dx / xfrm.va;
      xfrm.vdy += dy / xfrm.va;
      break;

    case "move":
      var dp = Vector2(-dx, dy).scaledBy(1 / xfrm.va);
      ["pa", "pb", "pc", "pd"].forEach(function (p) {
        xfrm[p] = xfrm[p].plus(dp);
      });
      break;

    case "rotate_scale":
      var c = Vector2(0, xfrm.vh / 4),
        prev = fromMouse(xp, yp).minus(c),
        now = fromMouse(x, y).minus(c);

      var thp = Math.atan2(prev.y, prev.x),
        thn = Math.atan2(now.y, now.x),
        dtheta = thp - thn,
        a = now.length() / prev.length();

      ["pa", "pb", "pc", "pd"].forEach(function (p) {
        xfrm[p] = xfrm[p]
          .minus(c)
          .rotatedAboutOrigin(dtheta)
          .scaledBy(a)
          .plus(c);
      });
      break;

    case "free_xfrm":
      var i = 0;
      if (xd < xfrm.vw / 2) i |= 1;
      if (yd < xfrm.vh / 2) i |= 2;

      var p = ["pa", "pb", "pc", "pd"];
      p.sort(function (a, b) {
        return xfrm[a].y - xfrm[b].y;
      });
      if (xfrm[p[0]].x < xfrm[p[1]].x) {
        var t = p[0];
        p[0] = p[1];
        p[1] = t;
      }
      if (xfrm[p[2]].x < xfrm[p[3]].x) {
        var t = p[2];
        p[2] = p[3];
        p[3] = t;
      }
      p = p[i];

      xfrm[p] = xfrm[p].plus(Vector2(-dx, dy).scaledBy(1 / xfrm.va));
      break;
  }

  solveForHomography();
}

function onePointTapInteraction(x, y) {
  var b = parseBittings(),
    p = fromMouse(x, y).scaledBy(1 / xfrm.pixelsPerInch),
    mx = p.x + b.width / 2,
    tol = 0.01;

  b.spacings.forEach(function (y) {
    if (isNaN(y)) return;
    if (
      p.x > -b.width / 2 &&
      p.x < b.width / 2 &&
      p.y > b.shoulder - y - tol &&
      p.y < b.shoulder - y + tol
    ) {
      if (y in manualDepths && Math.abs(manualDepths[y] - mx) < tol) {
        delete manualDepths[y];
      } else {
        manualDepths[y] = mx;
      }
    }
  });

  solveForHomography();
  render();
}

function mouseDown(ev) {
  xfrm.mx = ev.offsetX;
  xfrm.my = ev.offsetY;

  xfrm.mdx = xfrm.mx;
  xfrm.mdy = xfrm.my;

  xfrm.mdt = Date.now();

  ev.preventDefault();
}

function mouseUp(ev) {
  var dt = Date.now() - xfrm.mdt,
    p = Vector2(ev.offsetX, ev.offsetY);

  var dd = p.minus(Vector2(xfrm.mdx, xfrm.mdy)).length();

  if (dt < 200 && dd < 10) {
    onePointTapInteraction(ev.offsetX, ev.offsetY);
  }
  ev.preventDefault();
}

function mouseMove(ev) {
  if (!(ev.buttons & 1)) return;

  onePointMoveInteraction(
    ev.offsetX,
    ev.offsetY,
    xfrm.mx,
    xfrm.my,
    xfrm.mdx,
    xfrm.mdy
  );

  xfrm.mx = ev.offsetX;
  xfrm.my = ev.offsetY;

  ev.preventDefault();
  render();
}

function zoom(v) {
  xfrm.va *= Math.exp(v / 5);
  render();
}

var quantum = 500;
function mouseWheel(ev) {
  var d = ev.deltaY;
  if (Math.abs(d) < quantum) quantum = Math.abs(d);
  d /= quantum;

  var aa = Math.exp(-d / 30);

  switch ($("input[name=manip_mouse]:checked").val()) {
    case "viewport":
      xfrm.va *= Math.pow(aa, 10);
      break;
    case "move":
      ["pa", "pb", "pc", "pd"].forEach(function (p) {
        xfrm[p] = xfrm[p].scaledBy(aa);
      });
      solveForHomography();
      break;
  }

  ev.preventDefault();
  render();
}

function saveTouches(ev, down) {
  var r = ev.target.getBoundingClientRect();
  for (var i = 0; i < ev.touches.length; i++) {
    var touch = ev.touches[i],
      x = touch.pageX - r.left,
      y = touch.pageY - r.top,
      id = touch.identifier;

    xfrm.t[id] = Vector2(x, y);
    if (down) {
      xfrm.td[id] = Vector2(x, y);
      xfrm.td[id].t = Date.now();
    }
  }
}

function touchStart(ev) {
  saveTouches(ev, true);

  ev.preventDefault();
}

function touchMove(ev) {
  var r = ev.target.getBoundingClientRect();

  if (ev.touches.length == 1) {
    var touch = ev.touches[0],
      x = touch.pageX - r.left,
      y = touch.pageY - r.top,
      id = touch.identifier;

    onePointMoveInteraction(
      x,
      y,
      xfrm.t[id].x,
      xfrm.t[id].y,
      xfrm.td[id].x,
      xfrm.td[id].y
    );

    xfrm.t[id] = Vector2(x, y);
  } else if (ev.touches.length == 2) {
    var touch0 = ev.touches[0],
      t0 = Vector2(touch0.pageX - r.left, touch0.pageY - r.top),
      t0p = xfrm.t[touch0.identifier],
      touch1 = ev.touches[1],
      t1 = Vector2(touch1.pageX - r.left, touch1.pageY - r.top),
      t1p = xfrm.t[touch1.identifier];

    var d = t0.minus(t1),
      dp = t0p.minus(t1p),
      c = t0.plus(t1).scaledBy(0.5),
      cp = t0p.plus(t1p).scaledBy(0.5),
      dc = c.minus(cp);

    var l = d.length(),
      lp = dp.length(),
      a = l / lp;

    var th = Math.atan2(d.y, d.x),
      thp = Math.atan2(dp.y, dp.x),
      theta = th - thp;

    switch ($("input[name=manip_mouse]:checked").val()) {
      case "viewport":
        var nva = xfrm.va * a;

        // out = (in - vwh)*(1/va) - vdxy
        //
        // (t0pm)*(1/va) - vdxy = (t0m)*(1/nva) - nvdxy
        // nvdxy = (t0m)*(1/nva) - (t0pm)*(1/va) = vdxy
        //
        // but TODO fix the stupid mirrored coordinate system

        var vhw = Vector2(xfrm.vw / 2, -xfrm.vh / 2),
          t0pm = Vector2(t0p.x, -t0p.y).minus(vhw),
          t0m = Vector2(t0.x, -t0.y).minus(vhw);

        var d = t0m.scaledBy(1 / nva).minus(t0pm.scaledBy(1 / xfrm.va));

        xfrm.vdx -= d.x;
        xfrm.vdy += d.y;

        xfrm.va = nva;
        break;

      case "move":
      case "rotate_scale":
        dc = fromMouse(dc).minus(fromMouse(0, 0));
        c = fromMouse(c);
        // scale factor and rotation angle unaffected by transform

        ["pa", "pb", "pc", "pd"].forEach(function (p) {
          var pt = xfrm[p];
          pt = pt.plus(dc);
          pt = pt.minus(c).scaledBy(a).rotatedAboutOrigin(theta).plus(c);
          xfrm[p] = pt;
        });
        solveForHomography();
        break;
    }
  }

  saveTouches(ev, false);

  ev.preventDefault();
  render();
}

function touchEnd(ev) {
  var r = ev.target.getBoundingClientRect();

  if (ev.changedTouches.length == 1 && ev.touches.length == 0) {
    var touch = ev.changedTouches[0],
      p = Vector2(touch.pageX - r.left, touch.pageY - r.top),
      id = touch.identifier,
      dd = p.minus(xfrm.td[id]).length(),
      dt = Date.now() - xfrm.td[id].t;

    if (dt < 200 && dd < 10) {
      onePointTapInteraction(p.x, p.y);
    }
  }

  ev.preventDefault();
}

function resetViewport() {
  xfrm.vdx = 0;
  xfrm.vdy = 0;
  xfrm.va = 1;
  render();
}

function mirror() {
  var t;
  t = xfrm.pa;
  xfrm.pa = xfrm.pd;
  xfrm.pd = t;
  t = xfrm.pb;
  xfrm.pb = xfrm.pc;
  xfrm.pc = t;

  solveForHomography();
  render();
}

function modalMessage(v) {
  $("#modal_inner").html(v);
  $("#modal_outer").css("display", "flex");
}

function help() {
  modalMessage(
    "Align the key in your photo to the guides. Consider only the maximum width of the key (red-to-red) and the position of the shoulder (blue).These should be accurate to about 0.001\", so zoom in for the final adjustment.<br><br>If the key is flat in the plane of the image, then you can align it with only the move and rotate/scale tools. If it's not, then use free transform.<br><br>The edges of the cuts will be detected automatically. If they're wrong, then zoom in for precision and click or tap to place manually, again to clear."
  );
}

// Initialize tabs by assigning click handlers and triggering the first one
function initializeTabs(tabList) {
  let first = true;
  Array.from(tabList).forEach((tabElement) => {
    const id = tabElement.id;
    tabElement.onclick = () => handleTabClick(id, tabList);

    // Trigger the first tab click
    if (first) tabElement.onclick();
    first = false;
  });
}

// Handle clicking a tab by performing checks, updating UI, and rendering content
function handleTabClick(id, tabList) {
  if (!validateTabClick(id)) return;

  const tabContentId = "content_" + id.slice(4);
  showTabContent(tabContentId);
  highlightSelectedTab(id, tabList);

  render();
  makeKeyCodeHtml();
}

// Validate if the tab click is allowed based on tab ID and app state
function validateTabClick(id) {
  if ((id === "tab_align" || id === "tab_code") && !photoMaterial) {
    modalMessage(
      "Need to load photograph of key before aligning and getting code."
    );
    return false;
  }

  const b = parseBittings();
  if ((id === "tab_photo" || id === "tab_align" || id === "tab_code") && !b) {
    modalMessage("Need to choose bitting before loading photograph.");
    return false;
  }

  if (id === "tab_code") getKeyCode();

  return true;
}

// Show the content associated with the selected tab, hiding others
function showTabContent(tabContentId) {
  const contentTabs = document.getElementById("content_of_tabs").children;
  Array.from(contentTabs).forEach((content) => {
    content.classList.toggle("hide", content.id !== tabContentId);
  });
}

// Highlight the selected tab and remove highlight from others
function highlightSelectedTab(selectedId, tabList) {
  Array.from(tabList).forEach((tabElem) => {
    tabElem.classList.toggle("sel", tabElem.id === selectedId);
  });
}

// Function to handle mouseenter and mouseleave for hover effect
function addFakeHoverEffect(element) {
  element.addEventListener("mouseenter", function (ev) {
    handleMouseEnter(ev);
  });
  element.addEventListener("mouseleave", function (ev) {
    handleMouseLeave(ev);
  });
}

// Function to add the "fakehover" class on mouseenter
function handleMouseEnter(ev) {
  const now = new Date().getTime();
  if (now < ev.target.blockMouseEnterUntil) return;
  ev.target.classList.add("fakehover");
}

// Function to remove the "fakehover" class on mouseleave
function handleMouseLeave(ev) {
  ev.target.classList.remove("fakehover");
}

// Function to handle touch events and prevent unwanted hover
function setupTouchBehavior(element) {
  element.ontouchstart = removeFakeHover;
  element.ontouchend = removeFakeHover;
  element.addEventListener("click", removeFakeHover);
  element.blockMouseEnterUntil = 0;
}

// Function to remove "fakehover" class and set the block timeout
function removeFakeHover(ev) {
  ev.target.classList.remove("fakehover");
  const t = new Date().getTime() + 1000;
  ev.target.blockMouseEnterUntil = t;
}

// Function to initialize hover and touch behaviors for the elements
function initializeHoverAndTouch() {
  const elements = document.querySelectorAll("button, div#list_of_tabs a");

  // Add hover effect
  elements.forEach(function (element) {
    addFakeHoverEffect(element);
    setupTouchBehavior(element);
  });
}

function main() {
  // Get the list of tabs and initialize the tab functionality
  const tabList = document.getElementById("list_of_tabs").children;
  initializeTabs(tabList);

  // Initialize behavior
  initializeHoverAndTouch();

  document.getElementById("file").addEventListener("change", loadImageFromFile);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(xfrm.vw, xfrm.vh);

  var al = document.getElementById("align");
  al.appendChild(renderer.domElement);
  al.addEventListener("mousemove", mouseMove);
  al.addEventListener("mousedown", mouseDown);
  al.addEventListener("mouseup", mouseUp);
  al.addEventListener("wheel", mouseWheel);
  al.addEventListener("touchstart", touchStart);
  al.addEventListener("touchmove", touchMove);
  al.addEventListener("touchend", touchEnd);

  $("input[name=manip_mouse]").change(() => {
    render();
  });
}

window.onload = main;
