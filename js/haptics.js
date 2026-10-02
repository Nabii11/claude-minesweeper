// A short tap of vibration. Android has navigator.vibrate; Safari on iPhone does not,
// but since iOS 18 toggling a native <input switch> plays the system haptic, so we
// keep a hidden one around and click it.

let label = null;

function iosSwitch() {
  if (!label) {
    label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
  }
  label.click();
}

export function haptic(enabled = true) {
  if (!enabled) return;
  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(12);
    else iosSwitch();
  } catch (_) { /* no haptics on this device */ }
}
