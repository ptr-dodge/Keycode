class HoverAndTouchHandler {
  constructor(selector = "button, div#list_of_tabs a") {
    this.selector = selector;
    this.elements = [];
    this._handleMouseEnter = this._handleMouseEnter.bind(this);
    this._handleMouseLeave = this._handleMouseLeave.bind(this);
    this._removeFakeHover = this._removeFakeHover.bind(this);
  }

  init() {
    this.elements = Array.from(document.querySelectorAll(this.selector));
    this.elements.forEach((element) => {
      element.addEventListener("mouseenter", this._handleMouseEnter);
      element.addEventListener("mouseleave", this._handleMouseLeave);
      element.ontouchstart = this._removeFakeHover;
      element.ontouchend = this._removeFakeHover;
      element.addEventListener("click", this._removeFakeHover);
      element.blockMouseEnterUntil = 0;
    });
  }

  destroy() {
    this.elements.forEach((element) => {
      element.removeEventListener("mouseenter", this._handleMouseEnter);
      element.removeEventListener("mouseleave", this._handleMouseLeave);
      element.ontouchstart = null;
      element.ontouchend = null;
      element.removeEventListener("click", this._removeFakeHover);
    });
    this.elements = [];
  }

  _handleMouseEnter(ev) {
    const now = new Date().getTime();
    if (now < ev.target.blockMouseEnterUntil) return;
    ev.target.classList.add("fakehover");
  }

  _handleMouseLeave(ev) {
    ev.target.classList.remove("fakehover");
  }

  _removeFakeHover(ev) {
    ev.target.classList.remove("fakehover");
    const t = new Date().getTime() + 1000;
    ev.target.blockMouseEnterUntil = t;
  }
}

export default HoverAndTouchHandler;
