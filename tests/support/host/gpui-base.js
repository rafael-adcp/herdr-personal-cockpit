// `gpui-base`, as much of it as this mod names.
import { element } from "../element.js";

export const v_flex = () => element();
export const h_flex = () => element();

/**
 * The text field's state. Real enough to drive: a test can type into it and
 * submit it, which is how the repo picker is exercised without a keyboard.
 */
export class InputState {
  static new(options = {}) {
    return new InputState(options);
  }

  constructor(options = {}) {
    this.options = options;
    this.text = options.value ?? "";
    this.handlers = new Map();
    this.range = null;
    this.focused = 0;
  }

  value() {
    return this.text;
  }

  set_selected_range(range) {
    this.range = range;
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }

  focus() {
    this.focused++;
  }

  // ---- for a test to drive it ---------------------------------------------

  /** Type, as somebody would: the value changes and `change` fires. */
  type(text, cx) {
    this.text = text;
    this.handlers.get("change")?.(null, cx);
  }

  /** Press enter. */
  submit(cx) {
    this.handlers.get("submit")?.(null, cx);
  }

  fire(event, cx) {
    this.handlers.get(event)?.(null, cx);
  }
}

export class Input {
  static new() {
    return element();
  }
}

export class TextareaState extends InputState {
  static new(options = {}) { return new TextareaState(options); }
  set_value(value) { this.text = value; }
}

export class Textarea extends Input {}
