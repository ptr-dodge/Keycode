// Bitting.js
// Extensible bitting class for key manufacturers

class Bitting {
  constructor(brand, pins) {
    this.brand = brand;
    this.pins = pins;
    this.spacings = [];
    this.depths = [];
    this.width = "";
    this.setBitting(brand, pins);
  }

  setBitting(brand, pins) {
    let spacings = [];
    let depths = [];
    let width = "";
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
      // Add more manufacturers here
      default:
        // Optionally handle unknown brands
        break;
    }
    this.spacings = spacings.slice(0, pins);
    this.depths = depths;
    this.width = width;
  }

  getSpacings() {
    return this.spacings;
  }

  getDepths() {
    return this.depths;
  }

  getWidth() {
    return this.width;
  }
}

export default Bitting;
