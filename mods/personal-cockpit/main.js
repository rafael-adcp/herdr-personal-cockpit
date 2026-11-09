// One mod, several screens, chosen by `props.kind`.
//
// `kind` is what lets two layout blocks run the same mod and still be two
// different panels -- and what lets the mod open its own repo dialog as an
// overlay, and hang a drawer off the window's edge, instead of needing a mod
// folder for each.
//
//   { "mod": "personal-cockpit", "props": { "kind": "pulls" } }     your pull requests
//   { "mod": "personal-cockpit", "props": { "kind": "issues" } }    Kraken Tasks
//   { "mod": "personal-cockpit", "props": { "kind": "urgent" } }    the floating drawer
//   { "mod": "personal-cockpit", "props": { "kind": "kit" } }       the chrome gallery
//   openOverlay({ mod: "personal-cockpit", props: { kind: "repo-picker", ... } })
//
// Add a screen by writing its module and naming it here. Nothing else in the
// mod has to know.

import { View } from "gpui-kit";
import { props } from "herdr";
import { Drawer } from "./drawer.js";
import { Gallery } from "./gallery.js";
import { List } from "./list.js";
import { Picker } from "./picker.js";
import { Jira } from "./jira.js";
import { QuerySettings } from "./jira-settings.js";

// A `kind` that is not here is a panel: the four panels name themselves with
// it, and so does `herdr-app check`, which renders the mod with no props at
// all. So the list panel is the default rather than an entry.
const SCREENS = {
  "repo-picker": Picker,
  jira: Jira,
  "jira-settings": QuerySettings,
  urgent: Drawer,
  kit: Gallery,
};

export default class Cockpit extends View {
  init(_props, cx) {
    // The screens are plain classes, not Views: one exported View per mod is
    // the rule, and a screen needs no lifecycle of its own beyond the `cx` it
    // is handed here.
    const Screen = SCREENS[props()?.kind] ?? List;
    this.screen = new Screen(this, cx);
  }

  render(cx) {
    return this.screen.render(cx);
  }

  close(cx) {
    this.screen.close?.(cx);
  }
}
