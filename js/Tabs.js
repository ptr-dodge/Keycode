class Tabs {
  /**
   * @param {HTMLElement[]} tabElements - Array or HTMLCollection of tab elements
   * @param {Function} onTabSelect - Callback when a tab is selected (id, tabList)
   * @param {Object} [options] - Optional settings (e.g., autoSelectFirst)
   */
  constructor(tabElements, onTabSelect, options = {}) {
    this.tabElements = Array.from(tabElements);
    this.onTabSelect = onTabSelect;
    this.options = Object.assign({ autoSelectFirst: true }, options);

    this.tabElements.forEach((tabElement, idx) => {
      const id = tabElement.id;
      tabElement.addEventListener("click", () => this.selectTab(id));
      // Optionally support keyboard navigation
      tabElement.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          this.selectTab(id);
          ev.preventDefault();
        }
      });
    });

    if (this.options.autoSelectFirst && this.tabElements.length > 0) {
      this.selectTab(this.tabElements[0].id);
    }
  }

  /**
   * Select a tab by ID and call the callback.
   * @param {string} id
   */
  selectTab(id) {
    if (typeof this.onTabSelect === "function") {
      this.onTabSelect(id, this.tabElements);
    }
  }
}

export default Tabs;
