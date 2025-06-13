import Vector2 from "./Vector2.js";

class Config {
  constructor() {
    this.pixelsPerInch = 360;
    this.vw = 700;
    this.vh = 660;
    this.mdx = 0;
    this.mdy = 0;
    this.mdt = 0;
    this.mx = 0;
    this.my = 0;
    this.touch = {};
    this.touchDown = {};
    this.vdx = 0;
    this.vdy = 0;
    this.va = 1;
    this.pa = new Vector2(0, 0);
    this.pb = new Vector2(0, 0);
    this.pc = new Vector2(0, 0);
    this.pd = new Vector2(0, 0);
    this.homography = [];
    this.inverseHomography = [];
  }
}

export default Config;
