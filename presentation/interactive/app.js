(() => {
  "use strict";

  const slides = Array.from(document.querySelectorAll(".slide"));
  const navigation = document.querySelector("#slide-nav");
  const count = document.querySelector("#slide-count");
  const progress = document.querySelector("#progress-fill");
  const previous = document.querySelector("#prev-slide");
  const next = document.querySelector("#next-slide");
  const status = document.querySelector("#live-status");
  const gateGrid = document.querySelector(".gate-grid");

  if (!slides.length || !navigation || !count || !progress || !previous || !next || !status || !gateGrid) return;

  const navigationButtons = slides.map((slide, index) => {
    const button = document.createElement("button");
    const number = document.createElement("span");
    const title = document.createElement("span");
    button.type = "button";
    button.setAttribute("aria-label", `Go to slide ${index + 1}: ${slide.dataset.title}`);
    button.setAttribute("aria-current", index === 0 ? "step" : "false");
    number.className = "nav-index";
    number.textContent = String(index + 1).padStart(2, "0");
    title.className = "nav-title";
    title.textContent = slide.dataset.title || `Slide ${index + 1}`;
    button.append(number, title);
    button.addEventListener("click", () => showSlide(index));
    navigation.append(button);
    return button;
  });

  let activeIndex = 0;

  function showSlide(requestedIndex, announce = true) {
    activeIndex = Math.min(slides.length - 1, Math.max(0, requestedIndex));
    slides.forEach((slide, index) => {
      const active = index === activeIndex;
      slide.hidden = !active;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      navigationButtons[index].setAttribute("aria-current", active ? "step" : "false");
    });
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === slides.length - 1;
    count.textContent = `${String(activeIndex + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
    progress.style.width = `${((activeIndex + 1) / slides.length) * 100}%`;
    if (announce) status.textContent = `Slide ${activeIndex + 1} of ${slides.length}: ${slides[activeIndex].dataset.title}`;
  }

  previous.addEventListener("click", () => showSlide(activeIndex - 1));
  next.addEventListener("click", () => showSlide(activeIndex + 1));

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      showSlide(activeIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      showSlide(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      showSlide(0);
    } else if (event.key === "End") {
      event.preventDefault();
      showSlide(slides.length - 1);
    }
  });

  for (let gate = 0; gate < 21; gate += 1) {
    const marker = document.createElement("i");
    marker.setAttribute("aria-hidden", "true");
    gateGrid.append(marker);
  }

  const signals = {
    "signal-a": {
      ref: "SIGNAL / 01",
      title: "Flexible pickup window",
      summary: "Sample feedback suggests the pickup cutoff is useful; the supporting note asks for clearer timing near closing.",
      quote: "A fictional example of a source-linked observation, shown for this presentation only."
    },
    "signal-b": {
      ref: "SIGNAL / 02",
      title: "Clearer item comparison",
      summary: "A synthetic discovery theme pairs interest in side-by-side details with a request for easier product comparison.",
      quote: "This sample is generated for the walkthrough and does not represent an actual customer record."
    }
  };

  const signalButtons = Array.from(document.querySelectorAll("[data-signal]"));
  const decisionButtons = Array.from(document.querySelectorAll("[data-decision]"));
  const stateText = document.querySelector("#decision-state");
  const statePill = document.querySelector(".review-state");
  const refText = document.querySelector("#signal-ref");
  const titleText = document.querySelector("#signal-title");
  const summaryText = document.querySelector("#signal-summary");
  const quoteText = document.querySelector("#signal-quote");
  const decisionNote = document.querySelector("#decision-note");
  let activeSignal = "signal-a";
  const decisions = new Map();

  function renderSignal(key) {
    const signal = signals[key];
    if (!signal || !stateText || !statePill || !refText || !titleText || !summaryText || !quoteText || !decisionNote) return;
    activeSignal = key;
    signalButtons.forEach((button) => {
      const active = button.dataset.signal === key;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    refText.textContent = signal.ref;
    titleText.textContent = signal.title;
    summaryText.textContent = signal.summary;
    quoteText.textContent = signal.quote;
    const decision = decisions.get(key);
    stateText.textContent = decision ? `${decision.toUpperCase()} LOCALLY` : "AWAITING REVIEW";
    statePill.classList.toggle("is-decided", Boolean(decision));
    decisionNote.textContent = decision
      ? `This ${decision} example exists in page memory only; no service was called.`
      : "The decision is held in page memory until you leave or reset this example.";
  }

  signalButtons.forEach((button) => button.addEventListener("click", () => renderSignal(button.dataset.signal)));
  decisionButtons.forEach((button) => button.addEventListener("click", () => {
    const decision = button.dataset.decision;
    if (decision !== "approved" && decision !== "rejected") return;
    decisions.set(activeSignal, decision);
    renderSignal(activeSignal);
    status.textContent = `Synthetic sample marked ${decision}. No service was called.`;
  }));

  renderSignal(activeSignal);
  showSlide(0, false);
})();
