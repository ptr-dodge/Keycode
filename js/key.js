"use strict";

let config = {
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
  touch: {},
  touchDown: {},

  // viewport zoom and pan
  vdx: 0,
  vdy: 0,
  va: 1,

  // rectangular photograph maps to this quad
  pa: Vector2(0, 0),
  pb: Vector2(0, 0),
  pc: Vector2(0, 0),
  pd: Vector2(0, 0),
  // hg is homography from photo bitmap coords to screen (rectified) coords, inverseHomography is inverse
  homography: [],
  inverseHomography: [],

  brands: {
    kw: {
      spacings: [0.247, 0.397, 0.547, 0.697, 0.847, 0.997],
      depths: ["unused", 0.329, 0.306, 0.283, 0.26, 0.237, 0.214, 0.191],
      width: "0.335",
    },

    sc: {
      spacings: [0.231, 0.3872, 0.5434, 0.6996, 0.8558, 1.012],
      depths: [0.335, 0.32, 0.305, 0.29, 0.275, 0.26, 0.245, 0.23, 0.215, 0.2],
      width: "0.343",
    },
  },
};

let renderer,
  toDispose,
  photoTexture,
  photoMaterial,
  photoBitmap,
  photoWidth,
  photoHeight;
let cv = [];
let manualDepths = {};
let pool;

function bitting(brand, pins) {
  let spacings = [];
  let depths = [];
  let width = "";

  let spacingsInput = document.getElementById("bitting_spacings");
  let widthInput = document.getElementById("bitting_width");
  let depthInput = document.getElementById("bitting_depths");

  switch (brand) {
    case "kw":
      spacings = [0.247, 0.397, 0.547, 0.697, 0.847, 0.997];
      depths = ["unused", 0.329, 0.306, 0.283, 0.26, 0.237, 0.214, 0.191];
      width = "0.335";
      break;

    case "sc":
      spacings = [0.231, 0.3872, 0.5434, 0.6996, 0.8558, 1.012];
      depths = [0.335, 0.32, 0.305, 0.29, 0.275, 0.26, 0.245, 0.23, 0.215, 0.2];
      width = "0.343";
      break;
    // we can add more cases for handling more key types
    default:
      // Handle unexpected brand values here if needed
      break;
  }

  spacings = spacings.slice(0, pins);

  spacingsInput.value = spacings
    .map(function (x) {
      return x.toFixed(4);
    })
    .join(", ");

  widthInput.value = width;
  depthInput.value = depths
    .map(function (x) {
      return x === "unused" ? x : x.toFixed(3);
    })
    .join(", ");
}

function loadImage(uri, sample) {
  let photoElement = document.getElementById("photo");
  let modal = document.getElementById("modal_outer");
  let modalInner = document.getElementById("modal_inner");
  let modalButton = modal.querySelector("#modal_ok");

  photoElement.onload = () => {
    const manager = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(manager);

    loader.load(
      uri,
      function (texture) {
        let img = photoElement;
        let canvas = document.getElementById("photoc");

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext("2d");
        ctx.willReadFrequently = true;
        ctx.drawImage(img, 0, 0);

        photoBitmap = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        photoWidth = canvas.width;
        photoHeight = canvas.height;

        texture.minFilter = THREE.LinearFilter;
        photoTexture = texture;

        photoMaterial = new THREE.MeshBasicMaterial({
          map: photoTexture,
          depthTest: false,
          side: THREE.DoubleSide,
        });

        if (!sample) {
          resetHomography();
        }

        manualDepths = {};

        getKeyCode();

        if (!sample) {
          modal.style.display = "none";
          modalButton.style.display = "inline-block";
        }

        document.getElementById("tab_align").click();
      },
      undefined,
      function (err) {
        console.log("Error loading texture:", err);
      }
    );
  };

  if (sample) {
    modalMessage(
      "Loaded sample image. The bitting has been set to KW1.<br><br>This image has already been aligned to the red and blue guides. If you select the Align tab, then you'll see the correct code.<br><br>When you load your own image, you'll need to align it to the guides by hand. Try moving and rotating the sample image. Watch how the green detected cuts and the code change, to learn how the tools work.<br><br>If the detected edges of the cuts are wrong, then click or tap to place manually, again to clear."
    );
  } else {
    modalInner.innerHTML = "Loading image...";
    modalButton.style.display = "none";
    modal.style.display = "flex";
  }

  photoElement.src = uri;
}

function loadSampleImage() {
  const sampleImage = "./images/sample.jfif";

  bitting("kw", 5);
  loadImage(sampleImage, true);

  config.homography = [
    0.5018518300223738, 0.03280486662499481, 0.008149327540922235,
    -0.019599621583268556, 0.8399745004999475, 0.20262731136053902,
    1.8410231821756825e-18, 3.6041222243318587e-19, 0.0017423903114348802,
  ];

  config.inverseHomography = [
    0.003369933236284373, -0.00013161138854292278, -0.00045605621394176343,
    0.00007863264438711157, 0.0020134029791094104, -0.23451188452733207,
    -3.5210555230054996e-18, -2.1255039632640669e-19, 0.9721052074142724,
  ];

  config.pa = Vector2(-1, -1).hg();
  config.pb = Vector2(-1, 1).hg();
  config.pc = Vector2(1, 1).hg();
  config.pd = Vector2(1, -1).hg();

  solveForHomography();
  resetViewport();
}

function normalizeHomography() {
  ["homography", "inverseHomography"].forEach(function (p) {
    let sum = 0;
    config[p].forEach(function (x) {
      sum += x * x;
    });
    sum = Math.sqrt(sum);
    config[p] = config[p].map(function (x) {
      return x / sum;
    });
  });
}

function solveForHomography() {
  function solve(ins, outs, hg) {
    const A = [];
    const b = [];
    const numIterations = 10;
    const numRows = 8;
    const numCols = 9;

    // Helper function to populate A and b
    function setMatrixRow(i, pin, pout) {
      const xPin = pin.x;
      const yPin = pin.y;
      const xPout = pout.x;
      const yPout = pout.y;

      A[i] = [xPin, yPin, 1, 0, 0, 0, -xPout * xPin, -xPout * yPin, -xPout];
      A[i + 1] = [0, 0, 0, xPin, yPin, 1, -yPout * xPin, -yPout * yPin, -yPout];

      b[i] = xPout;
      b[i + 1] = yPout;
    }

    // Fill matrix A and vector b
    for (let i = 0; i < numRows; i += 2) {
      const pin = ins[i / 2];
      const pout = outs[i / 2];
      setMatrixRow(i, pin, pout);
    }

    let x = hg;

    // Minimize norm(A*x) by coordinate descent
    for (let iter = 0; iter < numIterations; iter++) {
      for (let j = 0; j < numCols; j++) {
        let num = 0;
        let den = 0;

        for (let i = 0; i < numRows; i++) {
          den += A[i][j] * A[i][j];

          let sum = 0;
          for (let jj = 0; jj < numCols; jj++) {
            if (jj === j) continue;
            sum += A[i][jj] * x[jj];
          }

          num += A[i][j] * sum;
        }

        x[j] = -num / den;
      }
    }
  }

  let outs = [config.pa, config.pb, config.pc, config.pd],
    ins = [Vector2(-1, -1), Vector2(-1, 1), Vector2(1, 1), Vector2(1, -1)];

  solve(ins, outs, config.homography);
  solve(outs, ins, config.inverseHomography);

  normalizeHomography();
  getKeyCode();
}

function resetHomography() {
  let img = $("#photo")[0],
    r = img.naturalWidth / img.naturalHeight,
    mx = config.vw / 2,
    my = config.vh / 2;
  if (r > mx / my) {
    my = mx / r;
  } else {
    mx = my * r;
  }
  config.pa = Vector2(-mx, -my);
  config.pb = Vector2(-mx, my);
  config.pc = Vector2(mx, my);
  config.pd = Vector2(mx, -my);

  config.homography = [mx, 0, 0, 0, my, 0, 0, 0, 1];
  config.inverseHomography = [1 / mx, 0, 0, 0, 1 / my, 0, 0, 0, 1];
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
      return x ** 2 + y ** 2;
    },
    length: function () {
      return Math.sqrt(x ** 2 + y ** 2);
    },
    rotatedAboutOrigin: function (theta) {
      let c = Math.cos(theta),
        s = Math.sin(theta);
      return Vector2(c * x + s * y, -s * x + c * y);
    },
    TV3: function (k) {
      return new THREE.Vector3(this.x, this.y, 1);
    },
    afterHomography: function (hg) {
      let denom = hg[6] * x + hg[7] * y + hg[8];

      return Vector2(
        (hg[0] * x + hg[1] * y + hg[2]) / denom,
        (hg[3] * x + hg[4] * y + hg[5]) / denom
      );
    },
    hg: function () {
      return this.afterHomography(config.homography);
    },
    inverseHomography: function () {
      return this.afterHomography(config.inverseHomography);
    },
    toString: function () {
      return "(" + x.toFixed(6) + ", " + y.toFixed(6) + ")";
    },
  };
}

function parseBittings() {
  // Helper function to parse input as an array of floats
  function parseFloatArray(input) {
    return input.split(",").reduce((result, item) => {
      const num = parseFloat(item);
      if (!isNaN(num)) result.push(num);
      return result;
    }, []);
  }

  // Collect data from DOM and parse
  const width = parseFloat($("#bitting_width").val());
  const spacings = parseFloatArray($("#bitting_spacings").val());
  const depths = parseFloatArray($("#bitting_depths").val());

  // Validation checks
  if (isNaN(width) || spacings.length < 2 || depths.length < 2) {
    return undefined;
  }

  // Calculate max and min spacings
  const maxsp = Math.max(...spacings);
  const minsp = Math.min(...spacings);

  // Define constants
  const GUIDE_OFFSET = 0.1;
  const GUIDE_EXTENSION = 0.3;

  // Return object with original flat structure
  return {
    width,
    spacings,
    depths,
    maxsp,
    minsp,
    shoulder: maxsp / 2,
    guide: GUIDE_OFFSET,
    guideLength: maxsp + GUIDE_EXTENSION,
  };
}

function plotColorChannels(digit) {
  let sp = cv[digit];
  if (!sp) return;

  $("#code td").removeClass("sel");
  $("#code tr td:nth-child(" + (digit + 2).toString() + ")").addClass("sel");

  let bittings = parseBittings();

  let canvas = $("#graph")[0],
    ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let maxDepth = 100;
  bittings.depths.forEach(function (d) {
    if (!isNaN(d) && d < maxDepth) maxDepth = d;
    // max depth is min remaining width
  });

  let xmax = sp.x[sp.x.length - 1],
    xmin = sp.x[0];

  function mapX(x) {
    return ((x - xmin) * 700) / (xmax - xmin);
  }
  function mapY(y) {
    return 370 - 1.3 * y;
  }
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
  bittings.depths.forEach(function (x) {
    if (isNaN(x)) return;
    x = -bittings.width / 2 + x;

    ctx.moveTo(mapX(x), 20);
    ctx.lineTo(mapX(x), canvas.height - 25);
  });
  ctx.stroke();

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mapX(-bittings.width / 2 + sp.xedge), mapY(-10));
  ctx.lineTo(mapX(-bittings.width / 2 + sp.xedge), mapY(265));
  ctx.stroke();

  for (let i = 0; i < bittings.depths.length; i++) {
    let x = bittings.depths[i];
    if (isNaN(x)) continue;
    x = -bittings.width / 2 + x;

    ctx.fillStyle = "black";
    ctx.font = "22px sans-serif";
    let text = i.toString(),
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

    let d = sp[trace],
      dx = sp.x;

    for (let i = 0; i < sp.n; i++) {
      let x = mapX(dx[i]),
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
  if (!photoBitmap) return;

  let bitting = parseBittings();

  let mind = 100;
  bitting.depths.forEach(function (d) {
    if (isNaN(d)) return;
    if (d < mind) mind = d;
  });

  cv = [];

  bitting.spacings.slice(0).forEach(function (ysp) {
    if (isNaN(ysp)) return;

    let y = bitting.shoulder - ysp;
    let pr = [],
      pg = [],
      pb = [],
      px = [];

    // easy to get false edges off profile of key, so keep region tight on left
    let step = 0.001,
      beyond = 0.08,
      slop = 0.015;
    for (
      let x = -bitting.width / 2 + mind - slop;
      x < bitting.width / 2 + beyond;
      x += step
    ) {
      let tr = 0,
        tg = 0,
        tb = 0;
      [-0.002, -0.001, 0, 0.001, 0.002].forEach(function (dy) {
        let pt = Vector2(
            x * config.pixelsPerInch,
            (y + dy) * config.pixelsPerInch
          ),
          bpt = pt.inverseHomography();
        let bx = (((bpt.x + 1) / 2) * photoWidth) | 0,
          by = (((-bpt.y + 1) / 2) * photoHeight) | 0;

        let i = (photoWidth * by + bx) * 4;
        tr += photoBitmap[i + 0];
        tg += photoBitmap[i + 1];
        tb += photoBitmap[i + 2];
      });

      px.push(x);
      pr.push(tr / 5);
      pg.push(tg / 5);
      pb.push(tb / 5);
    }

    // first, look at difference between pixel and average of all to right
    let disc = [],
      rightN = 0,
      rightR = 0,
      rightG = 0,
      rightB = 0;
    for (let i = pr.length - 1; i >= 1; i--) {
      rightR += pr[i];
      rightG += pg[i];
      rightB += pb[i];
      rightN++;

      let rar = rightR / rightN,
        rag = rightG / rightN,
        rab = rightB / rightN,
        dr = rar - pr[i - 1],
        dg = rag - pr[i - 1],
        db = rab - pr[i - 1],
        dd = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
      // vaguely perceptual weight

      disc[i] = dd;
    }
    disc[0] = disc[1];

    // high-pass filter to find edge
    let hpf = [0.4, 0.7, 1, -1, -0.7, -0.4],
      hpfd = [0, 0, 0];
    for (let i = 3; i < disc.length - 2; i++) {
      let sum = 0;
      for (let j = 0; j < 6; j++) {
        sum += hpf[j] * disc[i + j - 3];
      }
      sum += 0;
      hpfd.push(sum);
    }
    hpfd.push(0, 0);

    // look at average noise a little beyond key
    let maxNoise = 6,
      discmaxi = disc.length - 1,
      margin = ((beyond - slop) / step) | 0;
    for (let i = hpfd.length - 1; i >= hpfd.length - margin; i--) {
      if (hpfd[i] > maxNoise) maxNoise = hpfd[i];
    }
    for (let i = hpfd.length - (margin + 1); i >= 0; i--) {
      if (hpfd[i] > maxNoise * 3) {
        let max = hpfd[i];
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

    let xedge = px[discmaxi],
      code = "?",
      dxedge = 100;
    xedge = bitting.width / 2 + xedge;

    let manual = false;
    if (ysp in manualDepths) {
      manual = true;
      xedge = manualDepths[ysp];
    }

    for (let i = 0; i < bitting.depths.length; i++) {
      let x = bitting.depths[i];
      if (isNaN(x)) continue;
      let dx = x - xedge;
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
}

function makeKeyCodeHtml() {
  $("#code").html("");

  let table = $("#code"),
    tra = $("<tr>"),
    trb = $("<tr>"),
    trc = $("<tr>"),
    i = 0;
  tra.append($("<th>").text("code"));
  trb.append($("<th>").text("error"));
  trc.append($("<th>"));
  cv.forEach(function (sp) {
    let axe = Math.abs(sp.xerror),
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

    let tda = $("<td>").text(code),
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

    let saveI = i;
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

function render() {
  if (!renderer) return;
  let b = parseBittings();
  if (!b) return;

  if (!pool) {
    pool = {};
    pool.m = {
      l: {},
      q: {},
    };

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

    for (let i = 0; i < 4; i++) {
      pool.m.q[i] = new THREE.MeshBasicMaterial({
        color: [0x00ffff, 0xff00ff, 0xffff00, 0x00ff00][i],
        opacity: 0.2,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      });
    }

    let camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
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
  for (let i = 0; i < 4; i++) {
    pool.g.q[i] = new THREE.Geometry();
  }

  if (pool.s.children !== undefined) {
    while (pool.s.children.length > 0) {
      pool.s.remove(pool.s.children[0]);
    }
  }

  let cpme = pool.c.projectionMatrix.elements;

  let ax = (config.va * 2) / config.vw,
    ay = (config.va * 2) / config.vh;

  let A = [
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
    -config.vdx * ax,
    config.vdy * ay,
    0,
    1,
  ];

  for (let i = 0; i < 16; i++) cpme[i] = A[i];

  let scene = pool.s,
    lgs = pool.g.l;

  function line(x0, y0, x1, y1, w, color) {
    let p0 = Vector2(x0, y0),
      p1 = Vector2(x1, y1),
      dp = p1.minus(p0),
      l = dp.length();

    // get fatter as we zoom in, but not too fat
    dp = dp.scaledBy(w / (Math.sqrt(config.va) * l * 2));

    let n = Vector2(-dp.y, dp.x),
      a = p0.plus(n),
      b = p1.plus(n),
      c = p1.minus(n),
      d = p0.minus(n);

    let lg = lgs[color],
      i = lg.vertices.length;
    lg.vertices.push(a.TV3(), b.TV3(), c.TV3());
    lg.faces.push(new THREE.Face3(i + 0, i + 1, i + 2));
    lg.vertices.push(a.TV3(), c.TV3(), d.TV3());
    lg.faces.push(new THREE.Face3(i + 3, i + 4, i + 5));
  }
  function inchLine(x0, y0, x1, y1, w, c) {
    let a = config.pixelsPerInch;
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
    let x = -b.width / 2 + sp.xedge;
    inchLine(x, sp.y - 0.03, x, sp.y + 0.03, 1, "y");
    if (sp.manual) {
      let o = Vector2(x - 0.04, sp.y + 0.02),
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

      let c = [1, 1, 0.8660254, 0.5, 0, -0.5, -0.8660254, -1, -1],
        s = [-0.3, 0, 0.5, 0.8660254, 1, 0.8660254, 0.5, 0, -0.3];

      o.y += ly + 0.3 * r;
      o.x += l / 2;
      for (let i = 1; i < c.length; i++) {
        il(r * c[i - 1], r * s[i - 1], r * c[i], r * s[i]);
      }
    }
  });

  // the photo; do a grid of quads, support CanvasRenderer and debug my homography
  let pg = pool.g.p;
  pg.faceVertexUvs[0] = [];
  let n = 10,
    c = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let u0 = i / n,
        u1 = (i + 1) / n,
        v0 = j / n,
        v1 = (j + 1) / n;

      let qa = Vector2(u0 * 2 - 1, v0 * 2 - 1).hg(),
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
  for (let c in lgs) {
    scene.add(new THREE.Mesh(lgs[c], pool.m.l[c]));
  }

  if (
    document.querySelector("input[name=manip_mouse]:checked")?.value ===
    "free_xfrm"
  ) {
    for (let i = 0; i < 4; i++) {
      let xs = i & 1 ? 1 : -1,
        ys = i & 2 ? 1 : -1,
        m = 600 / config.va;
      let a = Vector2(config.vdx, -config.vdy);
      let b = a.plus(Vector2(0, m * ys));
      let c = b.plus(Vector2(m * xs, 0));
      let d = a.plus(Vector2(m * xs, 0));

      let tg = pool.g.q[i];
      tg.vertices.push(a.TV3(), b.TV3(), c.TV3());
      tg.faces.push(new THREE.Face3(0, 1, 2));
      tg.vertices.push(a.TV3(), c.TV3(), d.TV3());
      tg.faces.push(new THREE.Face3(3, 4, 5));

      scene.add(new THREE.Mesh(tg, pool.m.q[i]));
    }
  }

  renderer.render(scene, pool.c);

  for (let c in pool.g.l) {
    pool.g.l[c].dispose();
  }
  for (let c in pool.g.q) {
    pool.g.q[c].dispose();
  }
  pool.g.p.dispose();
}

function fromMouse(x, y) {
  if (typeof x === "object") {
    y = x.y;
    x = x.x;
  }

  let r = Vector2(x, -y).minus(Vector2(config.vw / 2, -config.vh / 2));
  r = r.scaledBy(1 / config.va);
  return r.minus(Vector2(-config.vdx, config.vdy));
}

function onePointMoveInteraction(x, y, xp, yp, xd, yd) {
  let dx = xp - x,
    dy = yp - y;

  switch ($("input[name=manip_mouse]:checked").val()) {
    case "viewport":
      config.vdx += dx / config.va;
      config.vdy += dy / config.va;
      break;

    case "move":
      let dp = Vector2(-dx, dy).scaledBy(1 / config.va);
      ["pa", "pb", "pc", "pd"].forEach(function (p) {
        config[p] = config[p].plus(dp);
      });
      break;

    case "rotate_scale":
      let c = Vector2(0, config.vh / 4),
        prev = fromMouse(xp, yp).minus(c),
        now = fromMouse(x, y).minus(c);

      let thp = Math.atan2(prev.y, prev.x),
        thn = Math.atan2(now.y, now.x),
        dtheta = thp - thn,
        a = now.length() / prev.length();

      ["pa", "pb", "pc", "pd"].forEach(function (p) {
        config[p] = config[p]
          .minus(c)
          .rotatedAboutOrigin(dtheta)
          .scaledBy(a)
          .plus(c);
      });
      break;

    case "free_xfrm":
      let i = 0;
      if (xd < config.vw / 2) i |= 1;
      if (yd < config.vh / 2) i |= 2;

      let p = ["pa", "pb", "pc", "pd"];
      p.sort(function (a, b) {
        return config[a].y - config[b].y;
      });
      if (config[p[0]].x < config[p[1]].x) {
        let t = p[0];
        p[0] = p[1];
        p[1] = t;
      }
      if (config[p[2]].x < config[p[3]].x) {
        let t = p[2];
        p[2] = p[3];
        p[3] = t;
      }
      p = p[i];

      config[p] = config[p].plus(Vector2(-dx, dy).scaledBy(1 / config.va));
      break;
  }

  solveForHomography();
}

function onePointTapInteraction(x, y) {
  let b = parseBittings(),
    p = fromMouse(x, y).scaledBy(1 / config.pixelsPerInch),
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

function zoom(v) {
  config.va *= Math.exp(v / 5);
  render();
}

function resetViewport() {
  config.vdx = 0;
  config.vdy = 0;
  config.va = 1;
  render();
}

function mirror() {
  let t;
  t = config.pa;
  config.pa = config.pd;
  config.pd = t;
  t = config.pb;
  config.pb = config.pc;
  config.pc = t;

  solveForHomography();
  render();
}

function modalMessage(v) {
  document.getElementById("modal_inner").innerHTML = v;
  document.getElementById("modal_outer").style.display = "flex";
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

// Function to initialize hover and touch behaviors for the elements
function initializeHoverAndTouch() {
  const elements = document.querySelectorAll("button, div#list_of_tabs a");

  // Add hover effect
  elements.forEach(function (element) {
    element.addEventListener("mouseenter", function (ev) {
      const now = new Date().getTime();
      if (now < ev.target.blockMouseEnterUntil) return;
      ev.target.classList.add("fakehover");
    });

    element.addEventListener("mouseleave", function (ev) {
      ev.target.classList.remove("fakehover");
    });

    function removeFakeHover(ev) {
      ev.target.classList.remove("fakehover");
      const t = new Date().getTime() + 1000;
      ev.target.blockMouseEnterUntil = t;
    }

    element.ontouchstart = removeFakeHover;
    element.ontouchend = removeFakeHover;
    element.addEventListener("click", removeFakeHover);
    element.blockMouseEnterUntil = 0;
  });
}

function saveTouches(ev, down) {
  let r = ev.target.getBoundingClientRect();
  for (let i = 0; i < ev.touches.length; i++) {
    let touch = ev.touches[i],
      x = touch.pageX - r.left,
      y = touch.pageY - r.top,
      id = touch.identifier;

    config.touch[id] = Vector2(x, y);
    if (down) {
      config.touchDown[id] = Vector2(x, y);
      config.touchDown[id].t = Date.now();
    }
  }
}

function mouseUp(ev) {
  let dt = Date.now() - config.mdt,
    p = Vector2(ev.offsetX, ev.offsetY);

  let dd = p.minus(Vector2(config.mdx, config.mdy)).length();

  if (dt < 200 && dd < 10) {
    onePointTapInteraction(ev.offsetX, ev.offsetY);
  }
  ev.preventDefault();
}

function mouseDown(ev) {
  config.mx = ev.offsetX;
  config.my = ev.offsetY;

  config.mdx = config.mx;
  config.mdy = config.my;

  config.mdt = Date.now();

  ev.preventDefault();
}

function mouseMove(ev) {
  if (!(ev.buttons & 1)) return;

  onePointMoveInteraction(
    ev.offsetX,
    ev.offsetY,
    config.mx,
    config.my,
    config.mdx,
    config.mdy
  );

  config.mx = ev.offsetX;
  config.my = ev.offsetY;

  ev.preventDefault();
  render();
}

function mouseWheel(ev) {
  let quantum = 500;
  let d = ev.deltaY;

  // Normalize deltaY to the initial quantum value
  if (Math.abs(d) < quantum) {
    quantum = Math.abs(d);
  }
  d /= quantum;

  // Calculate the scaling factor based on delta
  let scaleFactor = Math.exp(-d / 30);

  // Determine which transformation to apply based on user input
  const manipulationMode = $("input[name=manip_mouse]:checked").val();
  if (manipulationMode === "viewport") {
    config.va *= Math.pow(scaleFactor, 10);
  } else if (manipulationMode === "move") {
    ["pa", "pb", "pc", "pd"].forEach((p) => {
      config[p] = config[p].scaledBy(scaleFactor);
    });
    solveForHomography();
  }

  // Prevent default behavior and render the updated view
  ev.preventDefault();
  render();
}

function touchStart(ev) {
  saveTouches(ev, true);

  ev.preventDefault();
}

function touchEnd(ev) {
  let r = ev.target.getBoundingClientRect();

  if (ev.changedTouches.length == 1 && ev.touches.length == 0) {
    let touch = ev.changedTouches[0],
      p = Vector2(touch.pageX - r.left, touch.pageY - r.top),
      id = touch.identifier,
      dd = p.minus(config.touchDown[id]).length(),
      dt = Date.now() - config.touchDown[id].t;

    if (dt < 200 && dd < 10) {
      onePointTapInteraction(p.x, p.y);
    }
  }

  ev.preventDefault();
}

function touchMove(ev) {
  let boundingRect = ev.target.getBoundingClientRect();

  if (ev.touches.length == 1) {
    let touch = ev.touches[0],
      x = touch.pageX - boundingRect.left,
      y = touch.pageY - boundingRect.top,
      id = touch.identifier;

    onePointMoveInteraction(
      x,
      y,
      config.touch[id].x,
      config.touch[id].y,
      config.touchDown[id].x,
      config.touchDown[id].y
    );

    config.touch[id] = Vector2(x, y);
  } else if (ev.touches.length == 2) {
    let touch0 = ev.touches[0],
      t0 = Vector2(
        touch0.pageX - boundingRect.left,
        touch0.pageY - boundingRect.top
      ),
      t0p = config.touch[touch0.identifier],
      touch1 = ev.touches[1],
      t1 = Vector2(
        touch1.pageX - boundingRect.left,
        touch1.pageY - boundingRect.top
      ),
      t1p = config.touch[touch1.identifier];

    let d = t0.minus(t1),
      dp = t0p.minus(t1p),
      c = t0.plus(t1).scaledBy(0.5),
      cp = t0p.plus(t1p).scaledBy(0.5),
      dc = c.minus(cp);

    let l = d.length(),
      lp = dp.length(),
      a = l / lp;

    let th = Math.atan2(d.y, d.x),
      thp = Math.atan2(dp.y, dp.x),
      theta = th - thp;

    switch (document.querySelector("input[name=manip_mouse]:checked")?.value) {
      case "viewport":
        let nva = config.va * a;

        let vhw = Vector2(config.vw / 2, config.vh / 2),
          t0pm = Vector2(t0p.x, t0p.y).minus(vhw),
          t0m = Vector2(t0.x, t0.y).minus(vhw);

        let d = t0m.scaledBy(1 / nva).minus(t0pm.scaledBy(1 / config.va));

        config.vdx -= d.x;
        config.vdy += d.y;

        config.va = nva;
        break;

      case "move":
      case "rotate_scale":
        dc = fromMouse(dc).minus(fromMouse(0, 0));
        c = fromMouse(c);
        // scale factor and rotation angle unaffected by transform

        ["pa", "pb", "pc", "pd"].forEach(function (p) {
          let pt = config[p];
          pt = pt.plus(dc);
          pt = pt.minus(c).scaledBy(a).rotatedAboutOrigin(theta).plus(c);
          config[p] = pt;
        });
        solveForHomography();
        break;
    }
  }

  saveTouches(ev, false);

  ev.preventDefault();
  render();
}

function main() {
  // Get the list of tabs and initialize the tab functionality
  const tabList = document.getElementById("list_of_tabs").children;
  initializeTabs(tabList);

  // Initialize behavior
  initializeHoverAndTouch();

  document.getElementById("file").addEventListener("change", (ev) => {
    let fr = new FileReader();
    fr.onload = function () {
      let dataUri = fr.result;
      loadImage(dataUri, false);
    };
    fr.readAsDataURL(ev.target.files[0]);
  });

  renderer = new THREE.WebGLRenderer({
    antialias: true,
  });
  renderer.setSize(config.vw, config.vh);

  let al = document.getElementById("align");
  al.appendChild(renderer.domElement);
  al.addEventListener("mouseup", mouseUp);
  al.addEventListener("mousedown", mouseDown);
  al.addEventListener("mousemove", mouseMove);
  al.addEventListener("wheel", mouseWheel);
  al.addEventListener("touchstart", touchStart);
  al.addEventListener("touchend", touchEnd);
  al.addEventListener("touchmove", touchMove);

  $("input[name=manip_mouse]").change(() => {
    render();
  });
}

window.onload = main;
