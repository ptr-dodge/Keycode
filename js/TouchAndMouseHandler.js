import Vector2 from "./Vector2.js";
import { onePointTapInteraction, solveForHomography } from "./key.js";

class TouchAndMouseHandler {
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
    this.render = options.render || (() => {});
  }

  handleTabClick(id, tabList, options = {}) {
    if (!this.validateTabClick(id)) return;
    const getContentId = options.getContentId || ((id) => "content_" + id.replace(/^tab_/, ""));
    const tabContentId = getContentId(id);
    showTabContent(tabContentId);
    highlightSelectedTab(id, tabList);
    if (tabConfig[id] && typeof tabConfig[id].onSelect === "function") {
      tabConfig[id].onSelect();
    } else if (typeof options.onSelect === "function") {
      options.onSelect(id);
    }
  }

  validateTabClick(id) {
    if ((id === "tab_align" || id === "tab_code") && !photoMaterial) {
      modal("Need to load photograph of key before aligning and getting code.");
      return false;
    }
    const b = parseBittings();
    if ((id === "tab_photo" || id === "tab_align" || id === "tab_code") && !b) {
      modal("Need to choose bitting before loading photograph.");
      return false;
    }
    if (id === "tab_code") getKeyCode();
    return true;
  }

  isTap(p1, p2, dt, threshold = 10, timeLimit = 200) {
    let distance = p1.minus(p2).length();
    return dt < timeLimit && distance < threshold;
  }

  saveTouches(ev, down) {
    for (let i = 0; i < ev.touches.length; i++) {
      let touch = ev.touches[i],
        { x, y } = getRelativePosition(touch, ev.target),
        id = touch.identifier;
      this.config.touch[id] = new Vector2(x, y);
      if (down) {
        this.config.touchDown[id] = new Vector2(x, y);
        this.config.touchDown[id].t = Date.now();
      }
    }
  }

  mouseUp(event) {
    let currentDate = Date.now() - this.config.mdt;
    let point1 = new Vector2(event.offsetX, event.offsetY);
    let point2 = new Vector2(this.config.mdx, this.config.mdy)
    if (this.isTap(point1, point2, currentDate)) {
      onePointTapInteraction(event.offsetX, event.offsetY, this.config);
    }
    event.preventDefault();
  }

  mouseDown(event) {
    this.config.mx = event.offsetX;
    this.config.my = event.offsetY;
    this.config.mdx = this.config.mx;
    this.config.mdy = this.config.my;
    this.config.mdt = Date.now();
    event.preventDefault();
  }

  mouseMove(event) {
    if (!(event.buttons & 1)) return;
    onePointMoveInteraction(
      event.offsetX,
      event.offsetY,
      this.config.mx,
      this.config.my,
      this.config.mdx,
      this.config.mdy,
      this.config // pass config
    );
    this.config.mx = event.offsetX;
    this.config.my = event.offsetY;
    event.preventDefault();
    this.render();
  }

  handleInput(event) {
    let quantum = 500;
    let d = 0;
    let translation = { x: 0, y: 0 };
    let scaleFactor = Math.exp(-d / 30);
    if (event.type === "wheel") {
      d = event.deltaY;
      if (Math.abs(d) < quantum) {
        quantum = Math.abs(d);
      }
      d /= quantum;
    } else if (event.type === "keydown") {
      switch (event.key) {
        case "ArrowUp":
          translation.y = scaleFactor;
          break;
        case "ArrowDown":
          translation.y = -scaleFactor;
          break;
        case "ArrowLeft":
          translation.x = -scaleFactor;
          break;
        case "ArrowRight":
          translation.x = scaleFactor;
          break;
        default:
          return;
      }
    }
    const manipulationMode = document.querySelector(
      "input[name=manip_mouse]:checked"
    );
    if (!manipulationMode) return;
    const mode = manipulationMode.value;
    switch (mode) {
      case "viewport":
        this.config.vx += translation.x;
        this.config.vy += translation.y;
        break;
      case "move":
        ["pa", "pb", "pc", "pd"].forEach((point) => {
          this.config[point].x += translation.x;
          this.config[point].y += translation.y;
        });
        solveForHomography();
        break;
    }
    if (event.type === "keydown") {
      event.preventDefault();
    }
    this.render();
  }

  touchStart(ev) {
    this.saveTouches(ev, true);
    ev.preventDefault();
  }

  touchEnd(ev) {
    let r = ev.target.getBoundingClientRect();
    if (ev.changedTouches.length == 1 && ev.touches.length == 0) {
      let touch = ev.changedTouches[0],
        p = new Vector2(touch.pageX - r.left, touch.pageY - r.top),
        id = touch.identifier,
        dd = p.minus(this.config.touchDown[id]).length(),
        dt = Date.now() - this.config.touchDown[id].t;
      if (dt < 200 && dd < 10) {
        onePointTapInteraction(p.x, p.y, this.config);
      }
    }
    ev.preventDefault();
  }

  touchMove(ev) {
    let boundingRect = ev.target.getBoundingClientRect();
    if (ev.touches.length == 1) {
      let touch = ev.touches[0],
        x = touch.pageX - boundingRect.left,
        y = touch.pageY - boundingRect.top,
        id = touch.identifier;
      onePointMoveInteraction(
        x,
        y,
        this.config.touch[id].x,
        this.config.touch[id].y,
        this.config.touchDown[id].x,
        this.config.touchDown[id].y,
        this.config // pass config
      );
      this.config.touch[id] = new Vector2(x, y);
    } else if (ev.touches.length == 2) {
      // ...existing code for two-finger touch...
    }
  }
}

// Moved from key.js
function fromMouse(x, y, config) {
  if (typeof x === "object") {
    y = x.y;
    x = x.x;
  }
  let r = new Vector2(x, -y).minus(new Vector2(config.vw / 2, -config.vh / 2));
  r = r.scaledBy(1 / config.va);
  return r.minus(new Vector2(-config.vdx, config.vdy));
}

function onePointMoveInteraction(x, y, xp, yp, xd, yd, config) {
  // Helper function to handle viewport movement
  function handleViewportMove(dx, dy) {
    config.vdx += dx / config.va;
    config.vdy += dy / config.va;
  }
  // Helper function to handle object movement
  function handleMove(dx, dy) {
    let dp = new Vector2(-dx, dy).scaledBy(1 / config.va);
    ["pa", "pb", "pc", "pd"].forEach(function (p) {
      config[p] = config[p].plus(dp);
    });
  }
  // Helper function to handle rotation and scaling
  function handleRotateScale(x, y, xp, yp) {
    let c = new Vector2(0, config.vh / 4);
    let prev = fromMouse(xp, yp, config).minus(c);
    let now = fromMouse(x, y, config).minus(c);
    let thp = Math.atan2(prev.y, prev.x);
    let thn = Math.atan2(now.y, now.x);
    let dtheta = thp - thn;
    let a = now.length() / prev.length();
    ["pa", "pb", "pc", "pd"].forEach(function (p) {
      config[p] = config[p]
        .minus(c)
        .rotatedAboutOrigin(dtheta)
        .scaledBy(a)
        .plus(c);
    });
  }
  // Helper function to handle free transformation
  function handleFreeXfrm(dx, dy, xd, yd) {
    let i = 0;
    if (xd < config.vw / 2) i |= 1;
    if (yd < config.vh / 2) i |= 2;
    let p = ["pa", "pb", "pc", "pd"];
    p.sort(function (a, b) {
      return config[a].y - config[b].y;
    });
    if (config[p[0]].x < config[p[1]].x) {
      [p[0], p[1]] = [p[1], p[0]];
    }
    if (config[p[2]].x < config[p[3]].x) {
      [p[2], p[3]] = [p[3], p[2]];
    }
    p = p[i];
    config[p] = config[p].plus(new Vector2(-dx, dy).scaledBy(1 / config.va));
  }
  let dx = xp - x;
  let dy = yp - y;
  const manipMouse = document.querySelector("input[name=manip_mouse]:checked");
  if (!manipMouse) return;
  const mode = manipMouse.value;
  switch (mode) {
    case "viewport":
      handleViewportMove(dx, dy);
      break;
    case "move":
      handleMove(dx, dy);
      break;
    case "rotate_scale":
      handleRotateScale(x, y, xp, yp);
      break;
    case "free_xfrm":
      handleFreeXfrm(dx, dy, xd, yd);
      break;
  }
  if (typeof solveForHomography === "function") solveForHomography();
}

export default TouchAndMouseHandler;
