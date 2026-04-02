# MEASUREMENT GUIDE — Tube Cross-Section Fitting

Print this page and follow the steps at your workbench.

---

## What You Need

- [ ] Flexible tape measure (tailor's tape or soft ruler)
- [ ] Digital calipers OR a ruler with mm markings
- [ ] Something with a straight edge (ruler, credit card, level)
- [ ] Pen and this sheet

**Optional but helpful:**
- [ ] Profile / contour gauge (~$10, copies the exact shape)
- [ ] Soft clay or putty (press the tube end into it to capture the profile)
- [ ] Phone camera (photograph the tube end with a ruler for scale)

---

## Step 1: Mark the Mounting Position

Before measuring, mark the exact spot on the tube where you want to mount. Use tape or a marker. Measurements should be taken at this position because tubes can change shape along their length.

**Mounting position description:**

________________________________________

---

## Step 2: Measure Circumference

Wrap the tape snugly around the tube at the marked position. Not tight enough to compress, not loose enough to have slack. Read where the tape overlaps.

**Circumference: __________ mm**

_Tip: Do this 2-3 times and average. Accuracy matters here._

---

## Step 3: Measure Width (widest dimension)

Using calipers or ruler, measure straight across the widest point. Hold perpendicular to the tube axis.

**Width: __________ mm**

---

## Step 4: Measure Height (perpendicular to width)

Rotate your calipers 90° from the width measurement. Measure the other dimension.

**Height: __________ mm**

---

## Step 5: Check for Flat Sides

Hold a straight edge (ruler, credit card) against one of the wider sides of the tube. Look for a gap between the straight edge and the tube surface.

- [ ] **No gap**: The side is flat → this is a **pseudo-ellipse** (stadium shape)
- [ ] **Curved gap visible**: The side is continuously curved → this is an **ellipse**
- [ ] **Hard to tell**: We'll test both shapes

If flat sides are present, estimate how long the flat section is:

**Flat section length: __________ mm** (or "N/A" if curved)

---

## Step 6: Optional — Trace or Photograph

**Option A (trace):** If you can access the tube end, hold paper against it and trace the outline. Label width and height on the tracing.

**Option B (photo):** Place a ruler next to the tube end, photograph straight-on. The ruler provides scale reference.

**Option C (clay):** Press the tube into soft clay, remove, measure the impression.

---

## Summary

Copy these values into a JSON file or report them to the system:

```
Tube location:       ________________________
Circumference:       __________ mm
Width:               __________ mm
Height:              __________ mm
Shape type:          circle / ellipse / pseudo_ellipse
Flat length:         __________ mm (if pseudo_ellipse)
Notes:               ________________________
```

---

## What Happens Next

1. **You submit measurements** → the system generates 5–7 thin test rings (each prints in ~10 min)
2. **You print the rings** and slide each one onto the tube at the marked position
3. **You report which fit best:**
   - "too tight" — can't get it on
   - "tight" — goes on but snug with resistance
   - "snug" — slides on with light pressure, minimal play ← **this is the goal**
   - "slightly loose" — fits but wobbles or has gaps
   - "too loose" — falls off or spins freely
4. **Pick the best two rings** → the system generates a narrowed set
5. **Repeat until you find "snug"** — usually takes 2–3 rounds

The winning ring shape becomes the cutout profile for your actual pipe clamp. A thin gasket will be added inside the clamp for grip and fine adjustment.

---

## Fit Report Template (per round)

```
Round: _____

Ring C0:  too_tight / tight / snug / slightly_loose / too_loose
Ring W+:  too_tight / tight / snug / slightly_loose / too_loose
Ring W-:  too_tight / tight / snug / slightly_loose / too_loose
Ring H+:  too_tight / tight / snug / slightly_loose / too_loose
Ring H-:  too_tight / tight / snug / slightly_loose / too_loose
Ring S+:  too_tight / tight / snug / slightly_loose / too_loose
Ring S-:  too_tight / tight / snug / slightly_loose / too_loose

Best two ring IDs:  __________ and __________

Notes: ________________________________________
```
