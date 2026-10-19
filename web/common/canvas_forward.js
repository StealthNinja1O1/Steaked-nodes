/**
 * Middle-click / wheel forwarding for DOM widgets.
 *
 * stolen from ComfyUI's forwardMiddleButtonToCanvas,
 * Forwarding the events to canvas.processMouse*
 *  lets the canvas handle the whole gesture.
 *
 * Do not preventDefault/stopPropagation the pointer events, the
 * canvas does its own handling, and suppressing events here breaks other shit
 *
 * Options:
 *   allWheel - forward wheel events aka let you scroll or not
 */

const isMiddlePointerInput = (e) => e.button === 1 || e.buttons === 4;
const isMiddleButtonHeld = (e) => (e.buttons & 4) === 4;
const isMiddleButtonEvent = (e) => e.button === 1;

export function forwardCanvasEvents(el, { allWheel = false } = {}) {
  const canvas = () => window.app?.canvas;

  const onPointerDown = (e) => {
    if (isMiddlePointerInput(e)) canvas()?.processMouseDown?.(e);
  };
  const onPointerMove = (e) => {
    if (isMiddleButtonHeld(e)) canvas()?.processMouseMove?.(e);
  };
  const onPointerUp = (e) => {
    if (isMiddleButtonEvent(e)) canvas()?.processMouseUp?.(e);
  };
  const onWheel = (e) => {
    if (!allWheel && !e.ctrlKey) return;
    e.preventDefault();
    canvas()?.processMouseWheel?.(e);
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("wheel", onWheel);
  };
}
