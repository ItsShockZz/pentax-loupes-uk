/**
 * product-tour.js
 * Scroll-driven cinematic tour (spec chapters 0–10), scrubbed across one
 * continuous piece of real PENTAX Loupes product footage — client-edited
 * and supplied as a single video, not a collection of separate clips.
 *
 * Because it's one file, the tour drives a single <video> element: each
 * chapter owns a short time range *within* that file (`videoStart`/
 * `videoEnd`), and scroll position within the chapter maps to a seek inside
 * that range — the video jumps between ranges as chapters change and scrubs
 * smoothly within a chapter, the same "scroll scrubs a video" technique
 * used on Apple product pages. Using one element (instead of the multi-clip
 * approach an earlier build used) also sidesteps a real Chrome quirk found
 * during development: a <video> that's never been rendered/played can
 * report readyState 4 while silently ignoring `currentTime` writes for
 * seconds at a time. A single, always-visible, always-active video never
 * hits that state.
 *
 * Architecture: a single tall wrapper (`.tour`) holds a `position: sticky`
 * stage (`.tour__stage`) plus one `.tour__chapter` panel per chapter, each
 * with its own copy already present in the DOM (crawlable, works without
 * JS — the video's `poster` frame is a real frame from the footage, so
 * there's always something to see even before/without scripting).
 */

/* ---------------------------------------------------------------------- */
/* Math helpers                                                            */
/* ---------------------------------------------------------------------- */

const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

const VIDEO_SRC = "videos/tour-master.mp4";

/* ---------------------------------------------------------------------- */
/* Scene config                                                            */
/*                                                                          */
/* `start`/`end` are fractions of the pinned scroll range. `videoStart`/   */
/* `videoEnd` are seconds *within* videos/tour-master.mp4.                 */
/*                                                                          */
/* videos/tour-master.mp4 is the client's own re-edit, transcoded straight */
/* through with no trim, reorder, or crop — same 1920x1080/24fps, same     */
/* 41.1667s length, frame-for-frame identical to the source .mov. Chapter  */
/* text/copy is unchanged and is being revised separately, on direction.   */
/*                                                                          */
/* "intro" is a cold open: just the first shot in the edit (a rotating,    */
/* settling reveal, warm top-lit), ending right as the edit cuts to the    */
/* tighter hinge/knob macro crop — plays full-screen with no text at all.  */
/* There's no matching element in index.html for it, so                    */
/* `_setActiveChapter` naturally leaves every real chapter panel hidden    */
/* while it's active. `align: "full"` (handled in `_sizeFrame`) is what    */
/* actually makes it full-screen; it isn't a real chapter otherwise.       */
/*                                                                          */
/* Every `videoStart`/`videoEnd` boundary below — including the intro's —  */
/* lands exactly on a real cut in the edit, found with ffmpeg's scene-     */
/* detection filter (`select='gt(scene,N)'`), not guessed or evenly split.  */
/* That's on purpose: an earlier version split the remaining video evenly  */
/* across chapters by time alone, which meant a chapter's video could      */
/* start partway through one shot and cut to a totally different one       */
/* before its text changed — the "settle" shot cutting to a sharp branded  */
/* eyepiece close-up under the same "01 — OPTICS" text was flagged as a    */
/* real example. Every chapter below now gets exactly one complete shot,   */
/* start to finish, and the next chapter always starts on a fresh one — no */
/* shot is ever split across a text change, and no two adjacent chapters   */
/* share a shot. The one deliberate exception is "colour": its two shots   */
/* are a genuine back-to-back colourway change in the edit itself (black → */
/* rose gold), which is the point of that chapter, not a mismatch. One     */
/* near-duplicate shot (a second, near-identical "holding the loupes up"   */
/* moment right after the first) was dropped rather than forced into a     */
/* chapter of its own. Chapter text/copy and `align` are otherwise         */
/* unchanged from before and are being revised separately, on direction.   */
/* ---------------------------------------------------------------------- */

const productScenes = [
  { id: "intro", start: 0.0, end: 0.18, videoStart: 0.0, videoEnd: 7.375, align: "full" },
  { id: "overview", start: 0.18, end: 0.2507, videoStart: 7.375, videoEnd: 10.167, align: "left" },
  { id: "optics", start: 0.2507, end: 0.3647, videoStart: 10.167, videoEnd: 14.667, align: "right" },
  { id: "parallel-viewing", start: 0.3647, end: 0.4016, videoStart: 14.667, videoEnd: 16.125, align: "left" },
  { id: "lightweight", start: 0.4016, end: 0.4438, videoStart: 17.542, videoEnd: 19.208, align: "right" },
  { id: "nose-bridge", start: 0.4438, end: 0.4818, videoStart: 19.208, videoEnd: 20.708, align: "left" },
  { id: "pupillary-distance", start: 0.4818, end: 0.5293, videoStart: 20.708, videoEnd: 22.583, align: "right" },
  { id: "protective-lens", start: 0.5293, end: 0.7161, videoStart: 22.583, videoEnd: 29.958, align: "left" },
  { id: "working-distance", start: 0.7161, end: 0.7636, videoStart: 29.958, videoEnd: 31.833, align: "right" },
  { id: "magnification", start: 0.7636, end: 0.8185, videoStart: 31.833, videoEnd: 34.0, align: "left" },
  { id: "colour", start: 0.8185, end: 0.9346, videoStart: 34.0, videoEnd: 38.583, align: "right" },
  { id: "illumination", start: 0.9346, end: 1.0, videoStart: 38.583, videoEnd: 41.0, align: "left" },
];

/* ---------------------------------------------------------------------- */
/* ProductTour controller                                                  */
/* ---------------------------------------------------------------------- */

class ProductTour {
  constructor({ wrapperEl, railEl, videoEl }) {
    this.wrapperEl = wrapperEl;
    this.railEl = railEl;
    this.videoEl = videoEl;
    this.frameWrapEl = wrapperEl.querySelector(".tour__frame-wrap");

    this.chapterEls = Array.from(document.querySelectorAll("[data-chapter]"));
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.activeIndex = -1;
    this._primed = false;
    this._rafId = null;
    this._inView = false;
    this._lastUpdateAt = 0;

    this.chapterEls.forEach((el) => {
      const scene = productScenes.find((s) => s.id === el.dataset.chapter);
      if (scene) el.classList.add(`tour__chapter--${scene.align}`);
    });

    this._buildRail();
  }

  start() {
    if (!this.videoEl) return;
    this.videoEl.muted = true;

    if (this.reducedMotion) {
      // Static-but-real: park on a representative frame instead of
      // scrubbing. The plain stacked layout (no `.tour--cinematic`) already
      // keeps every chapter visible and sequential. One seek near the start
      // doesn't need the full-file blob load below — that's only there to
      // make *repeated, arbitrary-direction* seeking reliable.
      this.videoEl.addEventListener(
        "loadedmetadata",
        () => this._primeVideo(() => (this.videoEl.currentTime = productScenes[0].videoStart + 1)),
        { once: true }
      );
      this.videoEl.src = VIDEO_SRC;
      this.videoEl.load();
      return;
    }

    this.wrapperEl.classList.add("tour--cinematic");
    if (this.railEl) this.railEl.removeAttribute("hidden");

    this._loadVideoSource();

    this._bindScroll();
    this._observeViewport();
    this._setActiveChapter(0);
  }

  /**
   * Loads the tour video as an in-memory blob instead of letting the
   * <video> stream it progressively over the network. Verified directly
   * against the source file (not guessed): the "overview" chapter's own
   * videoStart–videoEnd range is a completely different shot — a blue
   * hinge/knob macro close-up — from what was actually rendering there,
   * which matched the *next* chapter's ("optics") opening frame instead.
   * That's the same class of quirk the header comment already documents
   * for this codebase (a <video> silently not honoring a `currentTime`
   * write) — it just isn't limited to the one-time initial probe
   * _primeVideo() guards against; a seek back to an earlier, no-longer-
   * buffered byte range mid-scroll can land on a stale frame the same way.
   * Once the whole file is a blob URL, every seek — forward or backward —
   * is served from memory rather than depending on the browser's network/
   * buffer state for that particular byte range, so it can't stall or go
   * stale. Falls back to plain progressive streaming (the old behavior) if
   * the fetch itself fails, so the tour still works, just without that
   * guarantee.
   */
  _loadVideoSource() {
    const bindAndLoad = (src) => {
      this.videoEl.addEventListener("loadedmetadata", () => this._primeVideo(), { once: true });
      this.videoEl.src = src;
      this.videoEl.load();
      this.videoEl.pause();
    };

    fetch(VIDEO_SRC)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.blob();
      })
      .then((blob) => bindAndLoad(URL.createObjectURL(blob)))
      .catch(() => bindAndLoad(VIDEO_SRC));
  }

  /**
   * See the header comment: a freshly-loaded <video> can report readyState
   * 4 while silently ignoring `currentTime` writes for anywhere from under
   * a second up to several seconds. A trivial near-zero probe isn't a
   * reliable test of this on a larger file — the browser can satisfy a
   * sub-frame seek from the initial buffer without the decode pipeline
   * actually being seek-ready yet. This probes with a real, several-second
   * seek and waits for the `seeked` event that only fires once the browser
   * has genuinely completed it, retrying (~400ms apart, ~8s total) until
   * one actually lands, then calls back.
   */
  _primeVideo(onReady, attemptsLeft = 20) {
    const probeTarget = Math.min(2, (this.videoEl.duration || 4) - 0.5);
    let settled = false;

    const onSeeked = () => {
      if (settled) return;
      settled = true;
      this.videoEl.removeEventListener("seeked", onSeeked);
      this._primed = true;
      if (onReady) onReady();
      else this._requestFrame();
    };

    this.videoEl.addEventListener("seeked", onSeeked);
    this.videoEl.currentTime = probeTarget;

    setTimeout(() => {
      if (settled) return;
      this.videoEl.removeEventListener("seeked", onSeeked);
      settled = true;
      if (attemptsLeft <= 0) {
        // Give up gracefully rather than freeze the chapter forever — mark
        // primed anyway so scrubbing at least attempts normally.
        this._primed = true;
        if (onReady) onReady();
        else this._requestFrame();
        return;
      }
      this._primeVideo(onReady, attemptsLeft - 1);
    }, 400);
  }

  _buildRail() {
    if (!this.railEl) return;
    productScenes.forEach((scene, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "rail__dot";
      dot.setAttribute("aria-label", this._chapterLabel(scene.id));
      dot.addEventListener("click", () => this._scrollToScene(i));
      this.railEl.appendChild(dot);
    });
  }

  _chapterLabel(id) {
    const panel = this.chapterEls.find((el) => el.dataset.chapter === id);
    const heading = panel && panel.querySelector("h2, h3");
    return heading ? heading.textContent.trim() : id;
  }

  _scrollToScene(index) {
    const scene = productScenes[index];
    this.scrollToMoment(scene.id, scene.videoStart);
  }

  /**
   * Scrolls so the pinned tour lands on a specific moment (seconds within
   * videos/tour-master.mp4), not just a chapter's start — e.g. the
   * "colour" chapter is one continuous scroll range that happens to
   * contain three back-to-back real shots (black, red, silvergold), so a
   * caller like the colour swatch buttons in main.js can jump to whichever
   * one was clicked, not just the chapter's opening frame. Public: called
   * from outside this class.
   */
  scrollToMoment(chapterId, videoTime) {
    const scene = productScenes.find((s) => s.id === chapterId);
    if (!scene || scene.videoStart == null || scene.videoEnd == null) return;
    const local = clamp((videoTime - scene.videoStart) / (scene.videoEnd - scene.videoStart));
    const rect = this.wrapperEl.getBoundingClientRect();
    const total = this.wrapperEl.offsetHeight - window.innerHeight;
    const progress = scene.start + local * (scene.end - scene.start);
    const y = window.scrollY + rect.top + progress * total + 1;
    window.scrollTo({ top: y, behavior: this.reducedMotion ? "auto" : "smooth" });
  }

  _observeViewport() {
    this._io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this._inView = entry.isIntersecting;
          if (this._inView) this._requestFrame();
        });
      },
      { threshold: 0 }
    );
    this._io.observe(this.wrapperEl);
  }

  _bindScroll() {
    window.addEventListener("scroll", () => this._onScroll(), { passive: true });
    window.addEventListener(
      "resize",
      () => {
        if (this.activeIndex >= 0) this._sizeFrame(productScenes[this.activeIndex]);
        this._onScroll();
      },
      { passive: true }
    );
    this._requestFrame();
  }

  /**
   * `requestAnimationFrame` can, in some embedding/focus-loss scenarios,
   * stop delivering callbacks indefinitely — observed directly: a scheduled
   * frame simply never fires, `_rafId` stays permanently non-null, every
   * later `_requestFrame()` call silently no-ops forever (its only guard is
   * "is one already pending"), and the tour freezes on whatever chapter it
   * last reached no matter how much further the page is scrolled. A manual
   * `dispatchEvent(new Event("scroll"))` doesn't recover it either, since
   * that still routes through the same stuck gate. Since scroll events
   * fire independently of rAF, this watchdog uses them as the recovery
   * path: if too long has passed since `_update()` last actually ran, that
   * means rAF isn't delivering, so clear the (stuck) pending id and update
   * directly instead of just re-requesting a frame that may never come.
   * Time-gated so normal healthy scrolling still rides the smooth rAF
   * path, not this one, on every single scroll event.
   */
  _onScroll() {
    if (performance.now() - this._lastUpdateAt > 250) {
      this._rafId = null;
      this._update();
    } else {
      this._requestFrame();
    }
  }

  /**
   * Sizes and positions `.tour__frame-wrap` with explicit inline
   * width/height/left/top, computed here rather than left to CSS
   * aspect-ratio + vw/vh math. In testing, an aspect-ratio box whose width
   * came from one rule and max-height from another (needed so the video
   * can be a different size per chapter alignment) didn't reliably
   * re-resolve together after a later class swap — a real, reproducible
   * gap in this codebase's CSS engine, not just a one-off glitch. Computing
   * exact pixels here sidesteps it rather than fighting it, and is the
   * mechanism that keeps the video and the active chapter's copy from ever
   * overlapping: left/right chapters shift the video toward the side
   * opposite the copy; center chapters shrink and top-anchor it, opening a
   * dedicated band underneath for the copy.
   */
  _sizeFrame(scene) {
    if (!this.frameWrapEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isMobile = vw <= 900;
    const RATIO = 16 / 9;
    // Must match .tour__chapter's `padding: 0 6vw` and .tour__copy's
    // `max-width: 360px` in main.css — the video's size for left/right
    // chapters is *derived* from how much room the text column actually
    // needs, not a guessed vw-fraction that happens to leave enough (an
    // earlier version picked the video width first and only left a fixed
    // 3vw gutter, which a wide-enough video ate straight through — a real,
    // measured 57px overlap at 1440px wide, not a hypothetical one).
    const CHAPTER_PADDING_FRAC = 0.06;
    const TEXT_COLUMN_WIDTH = 360;
    let maxW;
    let maxH;

    if (scene.align === "full") {
      // The cold-open intro: no chapter copy exists for it at all (see the
      // productScenes comment above), so there's nothing to leave room
      // for — genuinely edge-to-edge.
      maxW = vw;
      maxH = vh;
    } else if (isMobile) {
      maxW = vw * 0.92;
      maxH = vh * 0.34;
    } else {
      const gutter = vw * 0.03;
      const edgeMargin = vw * 0.03;
      const textZone = vw * CHAPTER_PADDING_FRAC + TEXT_COLUMN_WIDTH + gutter;
      maxW = Math.min(vw - textZone - edgeMargin, 1600);
      maxH = vh * 0.88;
    }

    // Fit 16:9 inside the (maxW, maxH) budget — never crops or stretches
    // the source; whichever dimension is the tighter constraint wins and
    // the other derives from it.
    let w = maxW;
    let h = w / RATIO;
    if (h > maxH) {
      h = maxH;
      w = h * RATIO;
    }

    let left;
    let top;
    if (scene.align === "full") {
      left = (vw - w) / 2;
      top = (vh - h) / 2;
    } else if (isMobile) {
      left = (vw - w) / 2;
      top = vh * 0.03;
    } else {
      const edgeMargin = vw * 0.03;
      // align "left" means the COPY sits on the left, so the video shifts
      // all the way right instead (pinned `edgeMargin` off the right edge
      // — its left edge lands `textZone` from the viewport's left, clear
      // of the text column, as a consequence of how `w` was sized above).
      // align "right" is the mirror: video pinned `edgeMargin` off the
      // LEFT edge instead. (An earlier version used `textZone` here for
      // "right" too, which put the video on the wrong side entirely and
      // slammed it straight into the text — caught by measuring the actual
      // rendered boxes, not just eyeballing it.)
      left = scene.align === "left" ? vw - edgeMargin - w : edgeMargin;
      top = (vh - h) / 2;
    }

    this.frameWrapEl.style.width = `${Math.round(w)}px`;
    this.frameWrapEl.style.height = `${Math.round(h)}px`;
    this.frameWrapEl.style.left = `${Math.round(left)}px`;
    this.frameWrapEl.style.top = `${Math.round(top)}px`;
  }

  _requestFrame() {
    if (this._rafId || !this._inView) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._update();
    });
  }

  _update() {
    this._lastUpdateAt = performance.now();
    const rect = this.wrapperEl.getBoundingClientRect();
    const total = this.wrapperEl.offsetHeight - window.innerHeight;
    const progress = clamp(-rect.top / Math.max(total, 1));

    let idx = productScenes.findIndex((s) => progress >= s.start && progress < s.end);
    if (idx === -1) idx = progress >= 1 ? productScenes.length - 1 : 0;
    const scene = productScenes[idx];
    // Linear, not smoothstep: smoothstep's derivative is ~0 at t=0/t=1, so
    // right where a chapter *starts* — the exact moment its text/frame
    // transition fires — the video was barely advancing off videoStart for
    // a good stretch of scroll (verified: 20% into a chapter's scroll range,
    // smoothstep had only covered ~40% as much of the shot as linear would
    // have). On chapters that only span a few percent of the total scroll
    // range, that reads as "the clip stayed the same" through the whole
    // transition — the bug reported. A 1:1 scroll-to-seek mapping is also
    // what the header comment's own reference point (Apple's product-page
    // scroll-scrub) actually uses; easing the *seek* fights the "tied to
    // your scroll" feel that makes scrubbing read as responsive.
    const local = clamp((progress - scene.start) / (scene.end - scene.start));

    if (idx !== this.activeIndex) this._setActiveChapter(idx);

    // Chapters without a video moment assigned yet (`videoStart`/`videoEnd`
    // both null — see productScenes above) just hold the video wherever it
    // already is, rather than seeking to `lerp(null, null, local)` (NaN).
    if (this._primed && scene.videoStart != null && scene.videoEnd != null) {
      // Writes every tick, no skip-threshold: tour-master.mp4 is all-intra
      // now (every frame a keyframe), so a seek is cheap, and the tour is
      // scaled so a small scroll covers a small slice of video — skipping
      // sub-threshold changes would mean quantizing exactly the fine-
      // grained per-frame tracking that's the whole point now, not saving
      // anything that matters.
      this.videoEl.currentTime = lerp(scene.videoStart, scene.videoEnd, local);
    }

    if (this._inView) this._requestFrame();
  }

  _setActiveChapter(idx) {
    // The frame itself (_sizeFrame below) always snaps to its new
    // position/size instantly — no animation; an earlier version animated
    // that move with a FLIP transform, but on this page that read as the
    // video visibly sliding left/right between chapters, most noticeably
    // where two alignment flips sit close together.
    //
    // Instant video + a *symmetric* 700ms crossfade on the text is exactly
    // what caused the overlap this page actually shipped with: on an
    // alignment flip (the common case — see productScenes above), the
    // video's new position lands exactly where the OUTGOING chapter's text
    // still is, and that text was still fading out there for up to 700ms.
    // The fix is asymmetric, not a timing threshold: the outgoing chapter
    // is hidden instantly (in lockstep with the video's own instant snap),
    // while the incoming chapter still gets the normal CSS-defined 700ms
    // fade-in for the "smooth" feel. Since at most one chapter is ever
    // mid-fade-in at a time — a still-fading-in chapter that loses
    // is-active before finishing is itself hidden instantly, the moment it
    // does — this also can't pile up into multiple chapters' text ghosted
    // together during a fast scroll/fling, without needing a separate
    // rapid-scroll timing guard.
    this.activeIndex = idx;
    const scene = productScenes[idx];

    this.chapterEls.forEach((el) => {
      const shouldBeActive = el.dataset.chapter === scene.id;
      if (!shouldBeActive && el.classList.contains("is-active")) {
        el.style.transition = "none";
        el.classList.remove("is-active");
        void el.offsetWidth; // force the "none" above to actually apply
        el.style.transition = "";
      } else {
        el.classList.toggle("is-active", shouldBeActive);
      }
    });

    if (this.railEl) {
      Array.from(this.railEl.children).forEach((dot, i) => dot.classList.toggle("is-active", i === idx));
    }
    this._sizeFrame(scene);
  }
}

window.PentaxProductTour = { ProductTour, productScenes, clamp, lerp, smoothstep };
