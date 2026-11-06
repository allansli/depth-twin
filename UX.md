# Depth Twin — playing it

The mirror should feel like an instrument, not a lab bench. The dock is five words. The sculpture does the showing off.

## Gestures

| Gesture | What happens |
| --- | --- |
| Open palm | Moves the air cursor. It does not click. |
| Point, then rest about 0.4s | Confirms the dock control under the cursor. A ring fills while you rest. |
| Closed fist | Holds the twin, or lets it go. |
| Victory | Next material. |
| Thumb up | Capture a still. |

MediaPipe’s Gesture Recognizer is the primary reader. The old geometric pinch fought pointing and loose fists (`pinchDist < 0.07` with the other fingers curled), so pinch is no longer the click. If the gesture model cannot load, a landmark fallback still runs. In that fallback a very tight pinch can confirm, and it will not fire on an ordinary point.

Keys, if your hands are off camera: **M** material, **P** paint, **S** split, **H** hold, **C** capture. **F** also holds.

`?dev=1` shows the measured telemetry line and **Rehearse** (**G**). Rehearse plays a scripted hand through the same cursor, dwell, and gesture edges. Head parallax is automatic and drops out when pose is too slow for the frame budget. It is not a dock control.

## Dock

**Material** cycles Particles, Holo, Liquid Metal, Neon Wire, and Ember.

**Paint** lets a moving hand, and motion in the depth field, leave color that the volume absorbs.

**Split** shows the live camera on the left and the twin on the right.

**Hold** freezes inference and the sculpture.

**Capture** flashes and downloads a 1920×1080 PNG with a small Depth Twin mark. In split mode the still keeps the camera on the left half.

## Materials

- **Particles** (default). Depth picks the hue. Nearer surfaces keep more points. Motion leaves a soft trail and a little bloom.
- **Holo.** Refraction, fresnel rim, and scanlines on a liquid sheet.
- **Metal.** Chrome with a colored specular edge.
- **Wire.** Neon contours and a silhouette.
- **Ember.** A hot core and rising sparks.

Coming closer to the camera raises presence. Materials get brighter and more saturated from that.

## Without a camera

**Synthetic preview** is a drawn figure, labeled as such, and still runs the depth model.

`?look=1` skips the camera and the depth model and draws the materials on a built-in depth field. Add `&shot=1` to hide the chrome, and `&material=holo` (or `metal`, `wire`, `ember`, `particles`) to open on one material.

## Privacy

Camera pixels never leave the browser. The same line is on the page in English and Portuguese. Weights and the gesture task are downloaded once and cached. They are not the camera.
