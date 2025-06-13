class Vector2 {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  plus(b) {
    return new Vector2(this.x + b.x, this.y + b.y);
  }

  minus(b) {
    return new Vector2(this.x - b.x, this.y - b.y);
  }

  scaledBy(k) {
    return new Vector2(this.x * k, this.y * k);
  }

  lengthSquared() {
    return this.x ** 2 + this.y ** 2;
  }

  length() {
    return Math.sqrt(this.lengthSquared());
  }

  rotatedAboutOrigin(theta) {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return new Vector2(c * this.x + s * this.y, -s * this.x + c * this.y);
  }

  TV3(k) {
    // Assumes THREE is globally available
    return new THREE.Vector3(this.x, this.y, k !== undefined ? k : 1);
  }

  afterHomography(hg) {
    const denom = hg[6] * this.x + hg[7] * this.y + hg[8];
    return new Vector2(
      (hg[0] * this.x + hg[1] * this.y + hg[2]) / denom,
      (hg[3] * this.x + hg[4] * this.y + hg[5]) / denom
    );
  }

  hg(config) {
    return this.afterHomography(config.homography);
  }

  inverseHomography(config) {
    return this.afterHomography(config.inverseHomography);
  }

  toString() {
    return `(${this.x.toFixed(6)}, ${this.y.toFixed(6)})`;
  }
}

export default Vector2;
