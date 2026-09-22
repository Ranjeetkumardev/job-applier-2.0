import { Locator, Page } from "@playwright/test";
import path from "path";
import type { Profile } from "../config/profile.js";
import { logger } from "../utils/logger.js";

export interface SolveResult {
  answered: number;
  completed: boolean;
  unansweredQuestions: string[];
}

interface ChoiceOption {
  text: string;
  locator: Locator;   // the element we click (label if present, else the input)
  kind: "radio" | "checkbox";
  input: Locator;     // the actual <input>
}

export type FormSolver = ReturnType<typeof createFormSolver>;

export const createFormSolver = (page: Page, profile: Profile) => {
  // ── state ────────────────────────────────────────────────────
  const answeredQuestions = new Set<string>();

  const successPattern =
    /application submitted|applied successfully|successfully applied|thank you for applying|application sent|application received|already applied|similar jobs|jobs you may like/i;

  const greetingPatterns = [
    /thank you for showing interest/i,
    /kindly answer all/i,
    /answer all.*questions/i,
    /successfully apply/i,
  ];

  // ── text helpers ─────────────────────────────────────────────
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/node[\s.-]*js/g, "nodejs")
      .replace(/react[\s.-]*js/g, "reactjs")
      .replace(/next[\s.-]*js/g, "nextjs")
      .replace(/express[\s.-]*js/g, "expressjs")
      .replace(/ci\s*\/\s*cd/g, "cicd")
      .replace(/full[\s-]*stack/g, "full stack")
      .replace(/front[\s-]*end/g, "front end")
      .replace(/back[\s-]*end/g, "back end")
      .replace(/mern[\s-]*stack/g, "mern stack")
      .replace(/[^a-z0-9+#.\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const sanitizeAnswerLength = (answer: string, maxLength = 120): string => {
    if (!answer) return "N/A";
    const trimmed = answer.trim();
    return trimmed.length <= maxLength
      ? trimmed
      : trimmed.substring(0, maxLength).trim();
  };

  const isGreeting = (text: string): boolean =>
    greetingPatterns.some((pattern) => pattern.test(text));

  const isExperienceQuestion = (q: string): boolean => {
    const n = normalize(q);
    return (
      n.includes("experience") ||
      n.includes("how many years") ||
      n.includes("how much experience") ||
      n.includes("how long have you worked")
    );
  };

  const isYesNoQuestion = (q: string): boolean => {
    const n = normalize(q);
    return (
      n.startsWith("are you") ||
      n.startsWith("do you") ||
      n.startsWith("have you") ||
      n.startsWith("can you") ||
      n.startsWith("could you") ||
      n.startsWith("would you") ||
      n.startsWith("is this") ||
      n.startsWith("will you") ||
      n.includes("willing to") ||
      n.includes("comfortable") ||
      n.includes("available") ||
      n.includes("eligible") ||
      n.includes("open to") ||
      n.includes("face to face") ||
      n.includes("f2f") ||
      n.includes("in person")
    );
  };

  // ── Numeric range matcher ────────────────────────────────────
  const matchNumericOption = (
    options: ChoiceOption[],
    question: string,
    answer: string,
  ): ChoiceOption[] => {
    const numMatch = answer.match(/(\d+(?:\.\d+)?)/);
    if (!numMatch) return [];
    const target = Number(numMatch[1]);

    const isNumericQ =
      isExperienceQuestion(question) ||
      /ctc|salary|lpa|notice|days|years|yrs|months/i.test(question) ||
      /\d/.test(answer);

    if (!isNumericQ) return [];

    const matches: ChoiceOption[] = [];

    for (const o of options) {
      const t = o.text.toLowerCase();

      const range = t.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?)/);
      if (range) {
        const lo = Number(range[1]);
        const hi = Number(range[2]);
        if (target >= lo && target <= hi) matches.push(o);
        continue;
      }

      const above = t.match(
        /(?:more than\s*)?(\d+(?:\.\d+)?)\s*(?:\+|and above|or more|plus)/i,
      );
      if (above) {
        if (target >= Number(above[1])) matches.push(o);
        continue;
      }

      const below = t.match(/(?:less than|below|under|up to)\s*(\d+(?:\.\d+)?)/i);
      if (below) {
        if (target < Number(below[1])) matches.push(o);
        continue;
      }

      const single = t.match(
        /^(\d+(?:\.\d+)?)\s*(?:years?|yrs?|lpa|days?|months?)?$/i,
      );
      if (single && Number(single[1]) === Math.floor(target)) {
        matches.push(o);
      }
    }

    return matches;
  };

  // ── Domain keyword matcher (location/skill/education) ────────
  const matchByDomainHeuristics = (
    options: ChoiceOption[],
    question: string,
    answer: string,
  ): ChoiceOption[] => {
    const q = question;
    const ans = answer;

    const keywords = new Set<string>();

    const addWords = (src: string | undefined | null) => {
      if (!src) return;
      src
        .split(/[,/|]|\s+and\s+|\s+or\s+/i)
        .map((s) => normalize(s.trim()))
        .filter((s) => s.length > 1)
        .forEach((s) => keywords.add(s));
    };

    addWords(ans);
    addWords(profile.personal.currentLocation);
    (profile.personal.preferredLocations ?? []).forEach(addWords);
    (profile.professional.skills ?? []).forEach(addWords);
    addWords(profile.professional.highestQualification);
    addWords(profile.professional.degreeSpecialization);
    addWords(profile.professional.currentTitle);

    if (keywords.size === 0) return [];

    const isLocationQ =
      /\b(location|city|residing|relocate|based|where do you live|where are you)\b/i.test(q);

    const isSkillQ =
      /\b(skill|technology|tech stack|framework|language|proficien|experience with|worked with|familiar with|know)\b/i.test(q);

    const isEducationQ =
      /\b(qualification|degree|education|graduation|bachelor|master|b\.?tech|m\.?tech|b\.?e|m\.?e|mca|bca)\b/i.test(q);

    const isRelevantQ = isLocationQ || isSkillQ || isEducationQ;
    if (!isRelevantQ) return [];

    const matches = options.filter((o) => {
      const n = normalize(o.text);
      if (!n) return false;
      return [...keywords].some((kw) => {
        if (kw.length < 3) return false;
        const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${esc}\\b`, "i").test(n);
      });
    });

    return matches;
  };

  // ── answer resolution ────────────────────────────────────────
  const resolveAnswer = (questionText: string): string | null => {
    const question = normalize(questionText);
    if (!question) return null;

    const configuredAnswers = Object.entries(profile.answers).sort(
      ([a], [b]) => b.length - a.length,
    );

    for (const [key, value] of configuredAnswers) {
      const normalizedKey = normalize(key);
      if (question === normalizedKey || question.includes(normalizedKey)) {
        return sanitizeAnswerLength(value);
      }
    }

    if (isExperienceQuestion(question)) {
      const entries = Object.entries(profile.experienceYears).sort(
        ([a], [b]) => b.length - a.length,
      );
      for (const [skill, experience] of entries) {
        if (question.includes(normalize(skill))) {
          return sanitizeAnswerLength(experience);
        }
      }
    }

    if (
      question.includes("ai tool") ||
      question.includes("ai-assisted") ||
      question.includes("ai assisted") ||
      question.includes("developer tools") ||
      question.includes("development tools") ||
      question.includes("copilot") ||
      question.includes("coding tools") ||
      question.includes("chatgpt") ||
      question.includes("productivity tools")
    ) {
      return (
        profile.answers?.["ai tools"] ??
        "GitHub Copilot, ChatGPT, Claude, Ollama, LangChain"
      );
    }

    if (
      question.includes("reason for change") ||
      question.includes("why looking for change") ||
      question.includes("why change") ||
      question.includes("why switch") ||
      question.includes("reason for job switch") ||
      question.includes("why leaving")
    ) {
      return "Looking for technical growth, architectural ownership, and challenging engineering roles.";
    }

    if (
      question.includes("team size") ||
      question.includes("team leadership") ||
      question.includes("how many members") ||
      question.includes("how many engineers") ||
      question.includes("managed team") ||
      question.includes("people reporting")
    ) {
      return "4 backend engineers";
    }

    if (
      question.includes("least time") ||
      question.includes("notice period") ||
      question.includes("how soon can you join") ||
      question.includes("when can you join") ||
      question.includes("joining time") ||
      question.includes("earliest date") ||
      question.includes("how fast can you start") ||
      question.includes("how many days to join")
    ) {
      if (
        profile.professional.isServingNotice &&
        profile.professional.lastWorkingDay
      ) {
        return `Serving notice. LWD: ${profile.professional.lastWorkingDay}`;
      }
      return `${profile.professional.noticePeriodDays} days`;
    }

    if (
      question.includes("serving notice") ||
      question.includes("last working day") ||
      question.includes("lwd")
    ) {
      if (
        profile.professional.isServingNotice &&
        profile.professional.lastWorkingDay
      ) {
        return `Yes, LWD: ${profile.professional.lastWorkingDay}`;
      }
      return "No, not serving notice currently.";
    }

    if (question.includes("buyout") || question.includes("notice period buyout")) {
      return "Yes, buyout can be explored.";
    }

    if (
      question.includes("native place") ||
      question.includes("native town") ||
      question.includes("hometown") ||
      question.includes("place of birth") ||
      question.includes("where are you from") ||
      question.includes("home town") ||
      question.includes("native city")
    ) {
      return profile.personal.nativePlace ?? "N/A";
    }

    if (
      question.includes("face to face") ||
      question.includes("f2f") ||
      question.includes("in person") ||
      question.includes("attend interview") ||
      question.includes("walk in") ||
      question.includes("physical interview")
    ) {
      return "Yes";
    }

    if (
      question.includes("total experience") ||
      question.includes("work experience") ||
      question.includes("overall experience") ||
      question.includes("relevant experience")
    ) {
      return `${profile.professional.totalExperienceYears} years`;
    }

    if (
      question.includes("expected ctc") ||
      question.includes("expected salary") ||
      question.includes("salary expectation") ||
      question.includes("exp ctc")
    ) {
      if (profile.professional.expectedCTCLPA !== undefined) {
        return `${profile.professional.expectedCTCLPA} LPA`;
      }
      if (profile.professional.expectedCTC !== undefined) {
        return String(profile.professional.expectedCTC);
      }
    }

    if (
      question.includes("current ctc") ||
      question.includes("current salary") ||
      question.includes("present salary") ||
      question.includes("fixed ctc")
    ) {
      if (profile.professional.currentCTCLPA !== undefined) {
        return `${profile.professional.currentCTCLPA} LPA`;
      }
      if (profile.professional.currentCTC !== undefined) {
        return String(profile.professional.currentCTC);
      }
    }

    if (
      question.includes("current location") ||
      question.includes("currently located") ||
      question.includes("where do you live") ||
      question.includes("where are you located") ||
      question.includes("your location") ||
      question.includes("current city") ||
      question.includes("current base")
    ) {
      return profile.personal.currentLocation;
    }

    if (
      question.includes("preferred location") ||
      question.includes("preferred job location")
    ) {
      return profile.personal.preferredLocations.join(", ");
    }

    if (
      question.includes("qualification") ||
      question.includes("highest degree") ||
      question.includes("education")
    ) {
      return `${profile.professional.highestQualification} in ${profile.professional.degreeSpecialization}`;
    }

    if (question.includes("graduation year") || question.includes("passing year")) {
      return String(profile.professional.graduationYear);
    }

    if (question.includes("full name") || question === "name") {
      return profile.personal.fullName;
    }
    if (question.includes("email")) return profile.personal.email;
    if (
      question.includes("phone") ||
      question.includes("mobile") ||
      question.includes("contact number")
    ) {
      return profile.personal.phone;
    }

    if (
      question.includes("current designation") ||
      question.includes("current title") ||
      question.includes("current role")
    ) {
      return profile.professional.currentTitle;
    }
    if (question.includes("current company")) {
      return profile.professional.currentCompany ?? "N/A";
    }

    if (
      question.includes("rotational shift") ||
      question.includes("night shift") ||
      question.includes("flexible shift") ||
      question.includes("background verification") ||
      question.includes("background check") ||
      question.includes("willing to relocate") ||
      question.includes("comfortable with") ||
      question.includes("work from office") ||
      question.includes("work from home") ||
      question.includes("hybrid work")
    ) {
      return "Yes";
    }

    if (question.includes("linkedin")) {
      return "https://www.linkedin.com/in/ranjeet-kumar-16a6111b4/";
    }
    if (question.includes("portfolio") || question.includes("personal website")) {
      return "https://devranjeet.vercel.app/";
    }
    if (question.includes("github")) {
      return "https://github.com/Ranjeetkumardev";
    }
    if (question.includes("leetcode")) {
      return "https://leetcode.com/u/RanjeetDev/";
    }

    if (
      question.includes("when did you start working") ||
      question.includes("start date")
    ) {
      return "09/2023";
    }
    if (
      question.includes("career break") ||
      question.includes("break in career") ||
      question.includes("career status")
    ) {
      return "No";
    }
    if (
      question.includes("military") ||
      question.includes("served in") ||
      question.includes("defence") ||
      question.includes("armed forces")
    ) {
      return "Never served";
    }
    if (
      question.includes("disability") ||
      question.includes("differently abled") ||
      question.includes("handicapped")
    ) {
      return "I don't have a disability";
    }

    if (/worked with|experience with|familiar with|proficient in/i.test(question)) {
      return "Yes";
    }

    if (/gender|male|female/i.test(question)) {
      return (profile.personal as any).gender ?? "Male";
    }

    if (isYesNoQuestion(question)) return "Yes";

    return profile.answers.default ?? "N/A";
  };

  // ─────────────────────────────────────────────────────────────
  // ── CONTAINER DETECTION ──────────────────────────────────────
  // FIXED: Now accepts containers with radio/checkbox too (radio-only
  // questions were failing because only text inputs were accepted).
  // ─────────────────────────────────────────────────────────────
  const getActiveRecruiterContainer = async (): Promise<Locator | null> => {
    const candidates = [
      ".chatbot_Drawer",
      ".chatbot_DrawerContentWrapper",
      '[id$="ChatbotContainer"]',
      '[class*="chatbot_Drawer" i]',
      '[class*="chatbot_DrawerContentWrapper" i]',
    ];

    for (const selector of candidates) {
      const loc = page.locator(selector);
      const count = await loc.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i--) {
        const el = loc.nth(i);
        const visible = await el.isVisible({ timeout: 200 }).catch(() => false);
        if (!visible) continue;

        // Accept if ANY of: editable input, radio, checkbox is present
        const hasInteractable = await el
          .locator(
            [
              'div[contenteditable="true"]',
              '[role="textbox"]',
              "textarea",
              'input[type="text"]',
              'input[type="radio"]',
              'input[type="checkbox"]',
            ].join(", "),
          )
          .first()
          .isVisible({ timeout: 200 })
          .catch(() => false);

        if (!hasInteractable) {
          // Fallback: check existence (not visibility) of radio/checkbox,
          // since Naukri hides the actual input
          const hasHiddenChoice = await el
            .locator('input[type="radio"], input[type="checkbox"]')
            .first()
            .count()
            .then((c) => c > 0)
            .catch(() => false);
          if (!hasHiddenChoice) continue;
        }

        return el;
      }
    }
    return null;
  };

  const getChatbotOverlay = async (): Promise<Locator | null> => {
    return getActiveRecruiterContainer();
  };

  const getChatbotOverlayFromInput = async (
    input: Locator,
  ): Promise<Locator | null> => {
    const xpath = [
      'ancestor::div[contains(@class, "chatbot_Drawer")]',
      'ancestor::div[contains(@id, "ChatbotContainer")]',
      'ancestor::div[contains(@class, "chatbot_DrawerContentWrapper")]',
    ].join(" | ");

    const overlay = input.locator(`xpath=${xpath}`);
    return (await overlay.count()) > 0 ? overlay.first() : null;
  };

  const isRecruiterFlowVisible = async (timeout = 3000): Promise<boolean> => {
    const selectors = [
      ".chatbot_Drawer",
      ".chatbot_MessageContainer",
      '[id$="ChatbotContainer"]',
      '[class*="chatbot_DrawerContentWrapper" i]',
    ].join(", ");

    const elements = page.locator(selectors);
    const count = await elements.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      if (await elements.nth(i).isVisible({ timeout }).catch(() => false)) {
        return true;
      }
    }
    return false;
  };

  // ─────────────────────────────────────────────────────────────
  // ── QUESTION READING ─────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  const getVisibleQuestion = async (): Promise<string> => {
    const container = await getActiveRecruiterContainer();
    const scope = container ?? page;

    const candidates = [
      ".chatbot_MessageContainer li.botItem .botMsg span",
      "li.botItem .botMsg span",
      ".botMsg span",
      "li.botItem .botMsg",
      ".botMsg",
    ];

    const texts: string[] = [];

    for (const selector of candidates) {
      const els = scope.locator(selector);
      const count = await els.count().catch(() => 0);
      if (count === 0) continue;

      for (let i = 0; i < count; i++) {
        const el = els.nth(i);
        const visible = await el.isVisible({ timeout: 150 }).catch(() => false);
        if (!visible) continue;

        const text = ((await el.textContent().catch(() => "")) || "").trim();
        if (!text || text.length < 5 || text.length > 500) continue;
        if (isGreeting(text)) continue;

        texts.push(text);
      }

      if (texts.length > 0) break;
    }

    return texts.at(-1) ?? "";
  };

  // ─────────────────────────────────────────────────────────────
  // ── INPUT DETECTION ──────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  const isEditable = async (loc: Locator): Promise<boolean> => {
    const visible = await loc.isVisible({ timeout: 150 }).catch(() => false);
    if (!visible) return false;
    const enabled = await loc.isEnabled().catch(() => false);
    if (!enabled) return false;

    return loc
      .evaluate((el) => {
        if (el instanceof HTMLInputElement) {
          return (
            !el.disabled &&
            !el.readOnly &&
            ["text", "search", "tel", "url", "email"].includes(
              el.type.toLowerCase(),
            )
          );
        }
        if (el instanceof HTMLTextAreaElement) {
          return !el.disabled && !el.readOnly;
        }
        if (el instanceof HTMLElement) return el.isContentEditable;
        return false;
      })
      .catch(() => false);
  };

  const getTextInput = async (): Promise<Locator | null> => {
    const container = await getActiveRecruiterContainer();

    const knownSelectors = [
      'div[contenteditable="true"][data-placeholder]',
      'div.textArea[contenteditable="true"]',
      '[class*="textArea"][contenteditable="true"]',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      'textarea[placeholder*="message" i]',
      'input[placeholder*="message" i]',
    ];

    if (container) {
      for (const selector of knownSelectors) {
        const candidates = container.locator(selector);
        const count = await candidates.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const input = candidates.nth(i);
          if (await isEditable(input)) {
            logger.debug({ selector, scope: "container" }, "Chatbot input found");
            return input;
          }
        }
      }
    }

    for (const selector of knownSelectors) {
      const candidates = page.locator(selector);
      const count = await candidates.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const input = candidates.nth(i);
        const placeholder = (
          (await input.getAttribute("data-placeholder").catch(() => "")) ||
          (await input.getAttribute("placeholder").catch(() => "")) ||
          ""
        ).toLowerCase();
        if (/keyword|location|search/i.test(placeholder)) continue;

        if (await isEditable(input)) {
          logger.debug({ selector, scope: "page" }, "Chatbot input found");
          return input;
        }
      }
    }

    logger.warn("No chatbot input found");
    return null;
  };

  // ─────────────────────────────────────────────────────────────
  // ── RADIO / CHECKBOX OPTION DETECTION (FULLY REWRITTEN) ──────
  // ─────────────────────────────────────────────────────────────
  const getVisibleChoiceOptions = async (): Promise<ChoiceOption[]> => {
    const container = await getActiveRecruiterContainer();
    if (!container) {
      logger.warn("No container found for choice options");
      return [];
    }

    // DEBUG dump — helps diagnose Naukri's actual DOM structure
    const debugInfo = await container
      .evaluate((root) => {
        const inputs = Array.from(
          root.querySelectorAll('input[type="radio"], input[type="checkbox"]'),
        ) as HTMLInputElement[];

        return inputs.map((inp, idx) => {
          const rect = inp.getBoundingClientRect();
          const parent = inp.parentElement;
          const grandparent = parent?.parentElement;
          return {
            idx,
            type: inp.type,
            id: inp.id,
            name: inp.name,
            value: inp.value,
            checked: inp.checked,
            visible: rect.width > 0 && rect.height > 0,
            display: window.getComputedStyle(inp).display,
            parentTag: parent?.tagName,
            parentClass: parent?.className?.toString().slice(0, 80),
            parentText: parent?.textContent?.trim().slice(0, 60),
            grandparentTag: grandparent?.tagName,
            grandparentClass: grandparent?.className?.toString().slice(0, 80),
            grandparentText: grandparent?.textContent?.trim().slice(0, 60),
          };
        });
      })
      .catch((e) => {
        logger.error({ err: (e as Error).message }, "Debug eval failed");
        return [];
      });

    logger.info(
      { debugInfo, count: debugInfo.length },
      "🔍 Radio/checkbox DOM dump",
    );

    const options: ChoiceOption[] = [];

    for (const kind of ["radio", "checkbox"] as const) {
      const inputs = container.locator(`input[type="${kind}"]`);
      const count = await inputs.count().catch(() => 0);
      if (count === 0) continue;

      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);

        const id = await input.getAttribute("id").catch(() => null);
        const name = await input.getAttribute("name").catch(() => null);
        let labelText = "";
        let labelLocator: Locator | null = null;

        // ── Strategy 1: label[for="id"] ──────────────────────────
        if (id) {
          const label = container.locator(`label[for="${id}"]`).first();
          const labelVisible = await label
            .isVisible({ timeout: 150 })
            .catch(() => false);
          if (labelVisible) {
            labelText = ((await label.textContent().catch(() => "")) || "").trim();
            labelLocator = label;
          }
        }

        // ── Strategy 2: closest label ancestor ───────────────────
        if (!labelText) {
          const label = input.locator("xpath=ancestor::label[1]").first();
          const visible = await label
            .isVisible({ timeout: 150 })
            .catch(() => false);
          if (visible) {
            labelText = ((await label.textContent().catch(() => "")) || "").trim();
            labelLocator = label;
          }
        }

        // ── Strategy 3: nearest visible ancestor with short text ─
        // This is the KEY for Naukri custom radios.
        if (!labelText) {
          const wrapper = input.locator(
            "xpath=ancestor::*[self::div or self::li or self::span][position() <= 4]",
          );
          const wCount = await wrapper.count().catch(() => 0);
          for (let w = 0; w < wCount; w++) {
            const el = wrapper.nth(w);
            const visible = await el
              .isVisible({ timeout: 100 })
              .catch(() => false);
            if (!visible) continue;
            const text = ((await el.textContent().catch(() => "")) || "").trim();
            // Option text is usually short (< 200 chars)
            if (text && text.length > 1 && text.length < 200) {
              labelText = text;
              labelLocator = el;
              break;
            }
          }
        }

        // ── Strategy 4: aria-label / value ───────────────────────
        if (!labelText) {
          labelText =
            (await input.getAttribute("aria-label").catch(() => null)) ||
            (await input.getAttribute("value").catch(() => null)) ||
            "";
        }

        if (!labelText) {
          logger.warn(
            { kind, index: i, id, name },
            "Could not resolve label text for choice input",
          );
          continue;
        }

        options.push({
          text: labelText.replace(/\s+/g, " ").trim(),
          locator: labelLocator ?? input,
          kind,
          input,
        });
      }

      if (options.length > 0) break; // prefer checkbox first, else radio
    }

    logger.info(
      { count: options.length, options: options.map((o) => o.text) },
      "🎯 Resolved choice options",
    );

    return options;
  };

  // ─────────────────────────────────────────────────────────────
  // ── CHOOSE BEST OPTIONS (generic matcher) ────────────────────
  // ─────────────────────────────────────────────────────────────
  const chooseOptions = (
    options: ChoiceOption[],
    question: string,
    suggestedAnswer: string,
  ): ChoiceOption[] => {
    if (options.length === 0) return [];

    const q = normalize(question);
    const ans = normalize(suggestedAnswer);
    const isCheckbox = options[0].kind === "checkbox";
    const wrap = (picks: ChoiceOption[]) =>
      isCheckbox ? picks : picks.slice(0, 1);

    // ── 0. Split into real vs fallback options ───────────────────
    const isFallbackOption = (t: string) =>
      /^(none|none of (the )?above|other|others|n\/?a|not applicable|prefer not to say|no preference|any|all of the above)\b/i.test(
        t.trim(),
      );

    const realOptions = options.filter((o) => !isFallbackOption(o.text));
    const fallbackOptions = options.filter((o) => isFallbackOption(o.text));

    const pickFrom = (pool: ChoiceOption[]) => (pool.length > 0 ? pool : options);

    // ── 1. Exact / substring match with resolved answer ─────────
    if (ans && ans !== "n/a") {
      const exact = pickFrom(realOptions).filter((o) => {
        const n = normalize(o.text);
        return n === ans || n.includes(ans) || ans.includes(n);
      });
      if (exact.length > 0) {
        logger.debug(
          { matched: exact.map((o) => o.text) },
          "Option matched: exact answer",
        );
        return wrap(exact);
      }

      // 1b. Multi-part answer
      const answerParts = ans
        .split(/,|\s+and\s+|\s+or\s+|\/|\|/i)
        .map((p) => p.trim())
        .filter((p) => p.length > 1);

      if (answerParts.length > 0) {
        const partMatches = pickFrom(realOptions).filter((o) => {
          const n = normalize(o.text);
          return answerParts.some((part) => {
            if (part.length < 2) return false;
            const esc = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`\\b${esc}\\b`, "i").test(n);
          });
        });
        if (partMatches.length > 0) {
          logger.debug(
            { matched: partMatches.map((o) => o.text), answerParts },
            "Option matched: multi-part answer",
          );
          return wrap(partMatches);
        }
      }
    }

    // ── 2. Numeric range match ──────────────────────────────────
    const numericMatch = matchNumericOption(pickFrom(realOptions), q, ans);
    if (numericMatch.length > 0) {
      logger.debug(
        { matched: numericMatch.map((o) => o.text) },
        "Option matched: numeric range",
      );
      return wrap(numericMatch);
    }

    // ── 3. Yes/No questions ─────────────────────────────────────
    if (isYesNoQuestion(q) || /\b(yes|no)\b/i.test(ans)) {
      const wantYes = !/\bno\b/i.test(ans);
      const yn = pickFrom(realOptions).find((o) =>
        wantYes ? /^\s*yes\b/i.test(o.text) : /^\s*no\b/i.test(o.text),
      );
      if (yn) {
        logger.debug({ matched: yn.text, wantYes }, "Option matched: yes/no");
        return wrap([yn]);
      }
    }

    // ── 4. Domain heuristics ────────────────────────────────────
    const heuristics = matchByDomainHeuristics(pickFrom(realOptions), q, ans);
    if (heuristics.length > 0) {
      logger.debug(
        { matched: heuristics.map((o) => o.text) },
        "Option matched: domain heuristic",
      );
      return wrap(heuristics);
    }

    // ── 5. Fallback option ("None of above") ────────────────────
    if (fallbackOptions.length > 0) {
      logger.info(
        { picked: fallbackOptions[0].text },
        "No real option matched — picking fallback",
      );
      return wrap([fallbackOptions[0]]);
    }

    // ── 6. Last resort: first real option ───────────────────────
    logger.warn(
      { picked: options[0].text, question: q, answer: ans },
      "No match found — picking first option",
    );
    return wrap([options[0]]);
  };

  // ─────────────────────────────────────────────────────────────
  // ── CLICK CHOICE OPTION (robust for custom radios) ───────────
  // ─────────────────────────────────────────────────────────────
  const clickChoiceOption = async (option: ChoiceOption): Promise<void> => {
    logger.info({ text: option.text }, "Attempting to click choice");

    await option.locator.scrollIntoViewIfNeeded().catch(() => {});

    const alreadyChecked = await option.input.isChecked().catch(() => false);
    if (alreadyChecked) {
      logger.debug({ text: option.text }, "Already checked");
      return;
    }

    // Strategy 1: click the label / wrapper
    try {
      await option.locator.click({ timeout: 2500, force: true });
    } catch (e) {
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "Label click failed, trying input",
      );

      // Strategy 2: force check the underlying input
      try {
        await option.input.check({ force: true, timeout: 2000 });
      } catch {
        // Strategy 3: JS click the input
        await option.input
          .evaluate((el) => (el as HTMLElement).click())
          .catch(() => {});
      }
    }

    await page.waitForTimeout(300);

    let checked = await option.input.isChecked().catch(() => false);
    logger.info({ text: option.text, checked }, "Choice click result");

    // Strategy 4: manually set checked + dispatch events (last resort)
    if (!checked) {
      await option.input
        .evaluate((el) => {
          const input = el as HTMLInputElement;
          input.checked = true;
          input.dispatchEvent(new Event("click", { bubbles: true }));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        })
        .catch(() => {});
      await page.waitForTimeout(200);
      checked = await option.input.isChecked().catch(() => false);
      logger.info(
        { text: option.text, checked },
        "Choice click result (after JS fallback)",
      );
    }
  };

  // ─────────────────────────────────────────────────────────────
  // ── SUBMIT BUTTON CLICK ──────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  const clickChatbotSubmitButton = async (input: Locator): Promise<void> => {
    const container =
      (await getChatbotOverlayFromInput(input)) ??
      (await getActiveRecruiterContainer());

    const scope = container ?? page;

    const saveSelectors = [
      ".sendMsg",
      '[class*="sendMsg"]',
      'div[tabindex="0"]:has-text("Save")',
      'div:has-text("Save")',
      'button:has-text("Save")',
      'button:has-text("Submit")',
      'button[type="submit"]',
    ];

    for (const selector of saveSelectors) {
      const candidates = scope.locator(selector);
      const count = await candidates.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i--) {
        const btn = candidates.nth(i);
        const visible = await btn.isVisible({ timeout: 200 }).catch(() => false);
        if (!visible) continue;

        const text = ((await btn.textContent().catch(() => "")) || "").trim();
        if (selector === 'button[type="submit"]') {
          if (!/save|submit/i.test(text)) continue;
        }

        const disabled = await btn
          .evaluate((el) => {
            const parent = el.closest('[class*="send"]');
            if (!parent) return false;
            return /disabled/i.test(parent.className);
          })
          .catch(() => false);

        if (disabled) {
          logger.debug({ text }, "Save button still disabled — waiting 500ms");
          await page.waitForTimeout(500);
        }

        try {
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await btn.click({ timeout: 3000 });
          logger.info({ selector, text }, "Chatbot Save clicked");
          return;
        } catch (err) {
          logger.debug(
            { selector, err: err instanceof Error ? err.message : String(err) },
            "Normal click failed, trying DOM click",
          );
          await btn
            .evaluate((el) => (el as HTMLElement).click())
            .catch(() => {});
          return;
        }
      }
    }

    logger.warn("No Save control found — pressing Enter inside input");
    await input.focus().catch(() => {});
    await input.press("Enter").catch(() => {});
  };

  // ─────────────────────────────────────────────────────────────
  // ── TYPE INTO CONTENTEDITABLE ────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  const submitTextAnswer = async (
    input: Locator,
    answer: string,
  ): Promise<void> => {
    const sanitized = sanitizeAnswerLength(answer);

    await input.waitFor({ state: "visible", timeout: 5000 });
    if (!(await input.isEnabled().catch(() => false))) {
      throw new Error("Chatbot input is disabled");
    }

    await input.click();
    await page.waitForTimeout(150);

    const isContentEditable = await input
      .evaluate((el) => el instanceof HTMLElement && el.isContentEditable)
      .catch(() => false);

    if (isContentEditable) {
      await input.evaluate((el) => {
        if (el instanceof HTMLElement) el.textContent = "";
      });
      await input.pressSequentially(sanitized, { delay: 40 });

      await input.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      });
    } else {
      await input.fill("");
      await input.fill(sanitized);
      await input.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      });
    }

    const entered = isContentEditable
      ? ((await input.textContent().catch(() => "")) || "").trim()
      : (await input.inputValue().catch(() => "")).trim();

    if (!entered) throw new Error(`Could not type answer: "${sanitized}"`);

    logger.info({ answer: sanitized, entered }, "Answer typed");

    await page.waitForTimeout(500);
    await clickChatbotSubmitButton(input);
  };

  // ─────────────────────────────────────────────────────────────
  // ── SKIP / WAIT ──────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  const clickSkipQuestionButton = async (): Promise<boolean> => {
    const selectors = [
      'button:has-text("Skip this question")',
      'button:has-text("Skip")',
      'div[class*="skip"]',
      'span:has-text("Skip")',
    ];
    for (const selector of selectors) {
      const loc = page.locator(selector).first();
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        await loc.click().catch(() => {});
        logger.info("Skip clicked");
        return true;
      }
    }
    return false;
  };

  const applicationCompleted = async (): Promise<boolean> => {
    if (await isRecruiterFlowVisible(300)) return false;

    const body = (
      (await page.locator("body").textContent().catch(() => "")) || ""
    ).toLowerCase();
    if (successPattern.test(body)) return true;

    const appliedBtn = page.locator(
      'button:has-text("Applied"), .applied-button, [class*="applied"]',
    );
    if ((await appliedBtn.count()) > 0) {
      if (await appliedBtn.first().isVisible().catch(() => false)) return true;
    }
    return false;
  };

  const waitForQuestionChange = async (
    previous: string,
    timeout = 8_000,
  ): Promise<boolean> => {
    const prev = normalize(previous);
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await applicationCompleted()) return true;
      if (!(await isRecruiterFlowVisible(1000))) return false;

      await page.waitForTimeout(500);
      const current = await getVisibleQuestion();
      if (current && normalize(current) !== prev) return true;
    }
    return false;
  };

  // ─────────────────────────────────────────────────────────────
  // ── MAIN LOOP ────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  const solveCommonQuestions = async (
    maxQuestions = 12,
  ): Promise<SolveResult> => {
    let answered = 0;
    let idleAttempts = 0;
    const unanswered: string[] = [];

    while (answered < maxQuestions && idleAttempts < 10) {
      const chatOpen = await isRecruiterFlowVisible(500);
      if (!chatOpen && (await applicationCompleted())) {
        return { answered, completed: true, unansweredQuestions: unanswered };
      }

      await page.waitForTimeout(500);

      const question = await getVisibleQuestion();
      if (!question) {
        idleAttempts++;
        logger.debug({ idleAttempts }, "No question text visible yet");
        continue;
      }

      const norm = normalize(question);
      if (answeredQuestions.has(norm)) {
        idleAttempts++;
        continue;
      }

      let answer = resolveAnswer(question);
      if (!answer) {
        logger.warn({ question }, "No answer in profile.json — skipping");
        if (await clickSkipQuestionButton()) {
          answeredQuestions.add(norm);
          answered++;
          idleAttempts = 0;
          await waitForQuestionChange(question);
          continue;
        }
        answer = "N/A";
      }

      logger.info({ question, answer }, "Answering question");

      // ── 1. Radio / checkbox options take priority ──────────
      const choiceOptions = await getVisibleChoiceOptions();
      if (choiceOptions.length > 0) {
        logger.info(
          {
            count: choiceOptions.length,
            kind: choiceOptions[0].kind,
            options: choiceOptions.map((o) => o.text),
          },
          "Multiple-choice question detected",
        );

        const picks = chooseOptions(choiceOptions, question, answer);

        if (picks.length === 0) {
          logger.warn("No suitable choice — trying skip");
          if (await clickSkipQuestionButton()) {
            answeredQuestions.add(norm);
            answered++;
            idleAttempts = 0;
            await waitForQuestionChange(question);
            continue;
          }
        } else {
          for (const pick of picks) {
            await clickChoiceOption(pick);
            logger.info({ picked: pick.text }, "Choice option selected");
          }
        }

        await page.waitForTimeout(500);

        const anyInput = await getTextInput().catch(() => null);
        const anchor = anyInput ?? page.locator("body");
        await clickChatbotSubmitButton(anchor);

        answeredQuestions.add(norm);
        answered++;
        idleAttempts = 0;

        const advancedChoice = await waitForQuestionChange(question, 8000);
        if (!advancedChoice) {
          logger.warn({ question }, "No advance after choice submit");
          if (await clickSkipQuestionButton()) {
            await waitForQuestionChange(question);
            continue;
          }
          unanswered.push(question);
          return {
            answered,
            completed: false,
            unansweredQuestions: unanswered,
          };
        }
        continue;
      }

      // ── 2. Text input fallback ─────────────────────────────
      const input = await getTextInput();
      if (!input) {
        logger.warn({ question }, "No input found");
        if (await clickSkipQuestionButton()) {
          answeredQuestions.add(norm);
          answered++;
          idleAttempts = 0;
          await waitForQuestionChange(question);
          continue;
        }
        unanswered.push(question);
        return { answered, completed: false, unansweredQuestions: unanswered };
      }

      try {
        await submitTextAnswer(input, answer);
      } catch (err) {
        logger.error(
          { question, err: err instanceof Error ? err.message : String(err) },
          "Submit failed",
        );
        if (await clickSkipQuestionButton()) {
          answeredQuestions.add(norm);
          answered++;
          idleAttempts = 0;
          await waitForQuestionChange(question);
          continue;
        }
        unanswered.push(question);
        return { answered, completed: false, unansweredQuestions: unanswered };
      }

      answeredQuestions.add(norm);
      answered++;
      idleAttempts = 0;

      const advanced = await waitForQuestionChange(question, 8000);
      if (!advanced) {
        logger.warn({ question }, "No advance after submit");
        if (await clickSkipQuestionButton()) {
          await waitForQuestionChange(question);
          continue;
        }
        unanswered.push(question);
        return { answered, completed: false, unansweredQuestions: unanswered };
      }
    }

    return {
      answered,
      completed: await applicationCompleted(),
      unansweredQuestions: unanswered,
    };
  };

  // ─────────────────────────────────────────────────────────────
  // ── RESUME UPLOAD ────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  const uploadResumeIfNeeded = async (): Promise<boolean> => {
    const uploadInputs = page.locator('input[type="file"]');
    const count = await uploadInputs.count();
    if (count === 0) return false;

    const resumePath = profile.resume.path;
    if (!resumePath) {
      logger.warn("Resume path missing");
      return false;
    }
    const absolutePath = path.isAbsolute(resumePath)
      ? resumePath
      : path.resolve(process.cwd(), resumePath);

    for (let i = 0; i < count; i++) {
      const inp = uploadInputs.nth(i);
      const visible = await inp.isVisible({ timeout: 300 }).catch(() => false);
      if (!visible) continue;

      const isChatInput = await inp
        .evaluate(
          (el) =>
            el.closest(
              '.chatbot_Drawer, .chatbot_Modal, [id$="ChatbotContainer"], [role="dialog"]',
            ) !== null,
        )
        .catch(() => false);
      if (isChatInput) continue;

      await inp.setInputFiles(absolutePath);
      logger.info({ resumePath: absolutePath }, "Resume uploaded");
      return true;
    }

    logger.warn("Resume upload skipped (only chat inputs found)");
    return false;
  };

  return {
    resolveAnswer,
    solveCommonQuestions,
    uploadResumeIfNeeded,
    applicationCompleted,
  };
};


// import { Locator, Page } from "@playwright/test";
// import path from "path";
// import type { Profile } from "../config/profile.js";
// import { logger } from "../utils/logger.js";

// export interface SolveResult {
//   answered: number;
//   completed: boolean;
//   unansweredQuestions: string[];
// }
//    // ── RADIO / CHECKBOX OPTION SUPPORT ──────────────────────────
// //   interface RadioOption {
// //     text: string;
// //     locator: Locator;
// //   }
// interface ChoiceOption {
//   text: string;
//   locator: Locator;   // the element we click (label if present, else the input)
//   kind: "radio" | "checkbox";
//   input: Locator;     // the actual <input>
// }
  

// export type FormSolver = ReturnType<typeof createFormSolver>;

// export const createFormSolver = (page: Page, profile: Profile) => {
//   // ── state ────────────────────────────────────────────────────
//   const answeredQuestions = new Set<string>();

//   const successPattern =
//     /application submitted|applied successfully|successfully applied|thank you for applying|application sent|application received|already applied|similar jobs|jobs you may like/i;

//   const greetingPatterns = [
//     /thank you for showing interest/i,
//     /kindly answer all/i,
//     /answer all.*questions/i,
//     /successfully apply/i,
//   ];

//   // ── text helpers ─────────────────────────────────────────────
//   const normalize = (value: string): string =>
//     value
//       .toLowerCase()
//       .replace(/node[\s.-]*js/g, "nodejs")
//       .replace(/react[\s.-]*js/g, "reactjs")
//       .replace(/next[\s.-]*js/g, "nextjs")
//       .replace(/express[\s.-]*js/g, "expressjs")
//       .replace(/ci\s*\/\s*cd/g, "cicd")
//       .replace(/full[\s-]*stack/g, "full stack")
//       .replace(/front[\s-]*end/g, "front end")
//       .replace(/back[\s-]*end/g, "back end")
//       .replace(/mern[\s-]*stack/g, "mern stack")
//       .replace(/[^a-z0-9+#.\s]/g, " ")
//       .replace(/\s+/g, " ")
//       .trim();

//   const sanitizeAnswerLength = (answer: string, maxLength = 120): string => {
//     if (!answer) return "N/A";
//     const trimmed = answer.trim();
//     return trimmed.length <= maxLength
//       ? trimmed
//       : trimmed.substring(0, maxLength).trim();
//   };

//   const isGreeting = (text: string): boolean =>
//     greetingPatterns.some((pattern) => pattern.test(text));

//   const isExperienceQuestion = (q: string): boolean => {
//     const n = normalize(q);
//     return (
//       n.includes("experience") ||
//       n.includes("how many years") ||
//       n.includes("how much experience") ||
//       n.includes("how long have you worked")
//     );
//   };

//   const isYesNoQuestion = (q: string): boolean => {
//     const n = normalize(q);
//     return (
//       n.startsWith("are you") ||
//       n.startsWith("do you") ||
//       n.startsWith("have you") ||
//       n.startsWith("can you") ||
//       n.startsWith("could you") ||
//       n.startsWith("would you") ||
//       n.startsWith("is this") ||
//       n.startsWith("will you") ||
//       n.includes("willing to") ||
//       n.includes("comfortable") ||
//       n.includes("available") ||
//       n.includes("eligible") ||
//       n.includes("open to") ||
//       n.includes("face to face") ||
//       n.includes("f2f") ||
//       n.includes("in person")
//     );
//   };

// /**
//  * Numeric range matcher — handles:
//  *   "2 - 4 years", "2 to 4 yrs", "4+ years", "4 and above",
//  *   "Less than 2 years", "More than 5 years",
//  *   "3-6 LPA", "6-10 LPA", "10+ LPA"
//  */
// const matchNumericOption = (
//   options: ChoiceOption[],
//   question: string,
//   answer: string,
// ): ChoiceOption[] => {
//   // Extract the target number from the answer (e.g. "2.9 years", "8 LPA", "30 days")
//   const numMatch = answer.match(/(\d+(?:\.\d+)?)/);
//   if (!numMatch) return [];
//   const target = Number(numMatch[1]);

//   // Only apply if the question looks numeric
//   const isNumericQ =
//     isExperienceQuestion(question) ||
//     /ctc|salary|lpa|notice|days|years|yrs|months/i.test(question) ||
//     /\d/.test(answer);

//   if (!isNumericQ) return [];

//   const matches: ChoiceOption[] = [];

//   for (const o of options) {
//     const t = o.text.toLowerCase();

//     // a. "X to Y" / "X - Y" / "X–Y"
//     const range = t.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?)/);
//     if (range) {
//       const lo = Number(range[1]);
//       const hi = Number(range[2]);
//       if (target >= lo && target <= hi) matches.push(o);
//       continue;
//     }

//     // b. "X+", "X and above", "more than X"
//     const above = t.match(
//       /(?:more than\s*)?(\d+(?:\.\d+)?)\s*(?:\+|and above|or more|plus)/i,
//     );
//     if (above) {
//       if (target >= Number(above[1])) matches.push(o);
//       continue;
//     }

//     // c. "less than X", "below X", "under X"
//     const below = t.match(/(?:less than|below|under|up to)\s*(\d+(?:\.\d+)?)/i);
//     if (below) {
//       if (target < Number(below[1])) matches.push(o);
//       continue;
//     }

//     // d. Exact single number ("2 years", "3")
//     const single = t.match(/^(\d+(?:\.\d+)?)\s*(?:years?|yrs?|lpa|days?|months?)?$/i);
//     if (single && Number(single[1]) === Math.floor(target)) {
//       matches.push(o);
//     }
//   }

//   return matches;
// };

// /**
//  * Domain-specific keyword matching for non-numeric questions.
//  * Covers: skills, education, location, shift, relocation, work-mode,
//  *         notice period, gender/EEO, "have you worked with X", etc.
//  */
// const matchByDomainHeuristics = (
//   options: ChoiceOption[],
//   question: string,
//   answer: string,
// ): ChoiceOption[] => {
//   const q = question;
//   const ans = answer;

//   // Build a pool of keywords from the answer + profile
//   const keywords = new Set<string>();

//   const addWords = (src: string | undefined | null) => {
//     if (!src) return;
//     src
//       .split(/[,/|]|\s+and\s+|\s+or\s+/i)
//       .map((s) => normalize(s.trim()))
//       .filter((s) => s.length > 1)
//       .forEach((s) => keywords.add(s));
//   };

//   addWords(ans);
//   addWords(profile.personal.currentLocation);
//   (profile.personal.preferredLocations ?? []).forEach(addWords);
//   (profile.professional.skills ?? []).forEach(addWords);
//   addWords(profile.professional.highestQualification);
//   addWords(profile.professional.degreeSpecialization);
//   addWords(profile.professional.currentTitle);

//   if (keywords.size === 0) return [];

//   // Location / city questions
//   const isLocationQ =
//     /\b(location|city|residing|relocate|based|where do you live|where are you)\b/i.test(q);

//   // Skill / tech questions
//   const isSkillQ =
//     /\b(skill|technology|tech stack|framework|language|proficien|experience with|worked with|familiar with|know)\b/i.test(q);

//   // Education questions
//   const isEducationQ =
//     /\b(qualification|degree|education|graduation|bachelor|master|b\.?tech|m\.?tech|b\.?e|m\.?e|mca|bca)\b/i.test(q);

//   const isRelevantQ = isLocationQ || isSkillQ || isEducationQ;

//   if (!isRelevantQ) return [];

//   const matches = options.filter((o) => {
//     const n = normalize(o.text);
//     if (!n) return false;
//     return [...keywords].some((kw) => {
//       if (kw.length < 3) return false;
//       const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//       return new RegExp(`\\b${esc}\\b`, "i").test(n);
//     });
//   });

//   return matches;
// };

//   // ── answer resolution (unchanged) ────────────────────────────
//   const resolveAnswer = (questionText: string): string | null => {
//     const question = normalize(questionText);
//     if (!question) return null;

//     const configuredAnswers = Object.entries(profile.answers).sort(
//       ([a], [b]) => b.length - a.length,
//     );

//     for (const [key, value] of configuredAnswers) {
//       const normalizedKey = normalize(key);
//       if (question === normalizedKey || question.includes(normalizedKey)) {
//         return sanitizeAnswerLength(value);
//       }
//     }

//     if (isExperienceQuestion(question)) {
//       const entries = Object.entries(profile.experienceYears).sort(
//         ([a], [b]) => b.length - a.length,
//       );
//       for (const [skill, experience] of entries) {
//         if (question.includes(normalize(skill))) {
//           return sanitizeAnswerLength(experience);
//         }
//       }
//     }

//     if (
//       question.includes("ai tool") ||
//       question.includes("ai-assisted") ||
//       question.includes("ai assisted") ||
//       question.includes("developer tools") ||
//       question.includes("development tools") ||
//       question.includes("copilot") ||
//       question.includes("coding tools") ||
//       question.includes("chatgpt") ||
//       question.includes("productivity tools")
//     ) {
//       return (
//         profile.answers?.["ai tools"] ??
//         "GitHub Copilot, ChatGPT, Claude, Ollama, LangChain"
//       );
//     }

//     if (
//       question.includes("reason for change") ||
//       question.includes("why looking for change") ||
//       question.includes("why change") ||
//       question.includes("why switch") ||
//       question.includes("reason for job switch") ||
//       question.includes("why leaving")
//     ) {
//       return "Looking for technical growth, architectural ownership, and challenging engineering roles.";
//     }

//     if (
//       question.includes("team size") ||
//       question.includes("team leadership") ||
//       question.includes("how many members") ||
//       question.includes("how many engineers") ||
//       question.includes("managed team") ||
//       question.includes("people reporting")
//     ) {
//       return "4 backend engineers";
//     }

//     if (
//       question.includes("least time") ||
//       question.includes("notice period") ||
//       question.includes("how soon can you join") ||
//       question.includes("when can you join") ||
//       question.includes("joining time") ||
//       question.includes("earliest date") ||
//       question.includes("how fast can you start") ||
//       question.includes("how many days to join")
//     ) {
//       if (
//         profile.professional.isServingNotice &&
//         profile.professional.lastWorkingDay
//       ) {
//         return `Serving notice. LWD: ${profile.professional.lastWorkingDay}`;
//       }
//       return `${profile.professional.noticePeriodDays} days`;
//     }

//     if (
//       question.includes("serving notice") ||
//       question.includes("last working day") ||
//       question.includes("lwd")
//     ) {
//       if (
//         profile.professional.isServingNotice &&
//         profile.professional.lastWorkingDay
//       ) {
//         return `Yes, LWD: ${profile.professional.lastWorkingDay}`;
//       }
//       return "No, not serving notice currently.";
//     }

//     if (question.includes("buyout") || question.includes("notice period buyout")) {
//       return "Yes, buyout can be explored.";
//     }

//     if (
//       question.includes("native place") ||
//       question.includes("native town") ||
//       question.includes("hometown") ||
//       question.includes("place of birth") ||
//       question.includes("where are you from") ||
//       question.includes("home town") ||
//       question.includes("native city")
//     ) {
//       return profile.personal.nativePlace ?? "N/A";
//     }

//     if (
//       question.includes("face to face") ||
//       question.includes("f2f") ||
//       question.includes("in person") ||
//       question.includes("attend interview") ||
//       question.includes("walk in") ||
//       question.includes("physical interview")
//     ) {
//       return "Yes";
//     }

//     if (
//       question.includes("total experience") ||
//       question.includes("work experience") ||
//       question.includes("overall experience") ||
//       question.includes("relevant experience")
//     ) {
//       return `${profile.professional.totalExperienceYears} years`;
//     }

//     if (
//       question.includes("expected ctc") ||
//       question.includes("expected salary") ||
//       question.includes("salary expectation") ||
//       question.includes("exp ctc")
//     ) {
//       if (profile.professional.expectedCTCLPA !== undefined) {
//         return `${profile.professional.expectedCTCLPA} LPA`;
//       }
//       if (profile.professional.expectedCTC !== undefined) {
//         return String(profile.professional.expectedCTC);
//       }
//     }

//     if (
//       question.includes("current ctc") ||
//       question.includes("current salary") ||
//       question.includes("present salary") ||
//       question.includes("fixed ctc")
//     ) {
//       if (profile.professional.currentCTCLPA !== undefined) {
//         return `${profile.professional.currentCTCLPA} LPA`;
//       }
//       if (profile.professional.currentCTC !== undefined) {
//         return String(profile.professional.currentCTC);
//       }
//     }

//     if (
//       question.includes("current location") ||
//       question.includes("currently located") ||
//       question.includes("where do you live") ||
//       question.includes("where are you located")
//     ) {
//       return profile.personal.currentLocation;
//     }

//     if (
//       question.includes("preferred location") ||
//       question.includes("preferred job location")
//     ) {
//       return profile.personal.preferredLocations.join(", ");
//     }

//     if (
//       question.includes("qualification") ||
//       question.includes("highest degree") ||
//       question.includes("education")
//     ) {
//       return `${profile.professional.highestQualification} in ${profile.professional.degreeSpecialization}`;
//     }

//     if (question.includes("graduation year") || question.includes("passing year")) {
//       return String(profile.professional.graduationYear);
//     }

//     if (question.includes("full name") || question === "name") {
//       return profile.personal.fullName;
//     }
//     if (question.includes("email")) return profile.personal.email;
//     if (
//       question.includes("phone") ||
//       question.includes("mobile") ||
//       question.includes("contact number")
//     ) {
//       return profile.personal.phone;
//     }

//     if (
//       question.includes("current designation") ||
//       question.includes("current title") ||
//       question.includes("current role")
//     ) {
//       return profile.professional.currentTitle;
//     }
//     if (question.includes("current company")) {
//       return profile.professional.currentCompany ?? "N/A";
//     }

//     if (
//       question.includes("rotational shift") ||
//       question.includes("night shift") ||
//       question.includes("flexible shift") ||
//       question.includes("background verification") ||
//       question.includes("background check") ||
//       question.includes("willing to relocate") ||
//       question.includes("comfortable with") ||
//       question.includes("work from office") ||
//       question.includes("work from home") ||
//       question.includes("hybrid work")
//     ) {
//       return "Yes";
//     }

//     if (question.includes("linkedin")) {
//       return "https://www.linkedin.com/in/ranjeet-kumar-16a6111b4/";
//     }
//     if (question.includes("portfolio") || question.includes("personal website")) {
//       return "https://devranjeet.vercel.app/";
//     }
//     if (question.includes("github")) {
//       return "https://github.com/Ranjeetkumardev";
//     }
//     if (question.includes("leetcode")) {
//       return "https://leetcode.com/u/RanjeetDev/";
//     }

//     if (
//       question.includes("when did you start working") ||
//       question.includes("start date")
//     ) {
//       return "09/2023";
//     }
//     if (
//       question.includes("career break") ||
//       question.includes("break in career") ||
//       question.includes("career status")
//     ) {
//       return "No";
//     }
//     if (
//       question.includes("military") ||
//       question.includes("served in") ||
//       question.includes("defence") ||
//       question.includes("armed forces")
//     ) {
//       return "Never served";
//     }
//     if (
//       question.includes("disability") ||
//       question.includes("differently abled") ||
//       question.includes("handicapped")
//     ) {
//       return "I don't have a disability";
//     }
//     // Generic "have you worked with X" → Yes
// if (/worked with|experience with|familiar with|proficient in/i.test(question)) {
//   return "Yes";
// }

// // Gender / EEO — add to profile.json if needed
// if (/gender|male|female/i.test(question)) {
//   return (profile.personal as any).gender ?? "Male";
// }

//     if (isYesNoQuestion(question)) return "Yes";

//     return profile.answers.default ?? "N/A";
//   };

//   // ─────────────────────────────────────────────────────────────
//   // ── CONTAINER DETECTION (rewritten) ──────────────────────────
//   // The chat lives inside `.chatbot_Drawer` inside `#<hash>ChatbotContainer`.
//   // `.chatbot_Overlay` is just the backdrop — it must be ignored.
//   // ─────────────────────────────────────────────────────────────
//   const getActiveRecruiterContainer = async (): Promise<Locator | null> => {
//     const candidates = [
//       '.chatbot_Drawer',
//       '.chatbot_DrawerContentWrapper',
//       '[id$="ChatbotContainer"]',
//       '[class*="chatbot_Drawer" i]',
//       '[class*="chatbot_DrawerContentWrapper" i]',
//     ];

//     for (const selector of candidates) {
//       const loc = page.locator(selector);
//       const count = await loc.count().catch(() => 0);
//       for (let i = count - 1; i >= 0; i--) {
//         const el = loc.nth(i);
//         const visible = await el.isVisible({ timeout: 200 }).catch(() => false);
//         if (!visible) continue;

//         // Must contain a visible editable input
//         const hasInput = await el
//           .locator(
//             'div[contenteditable="true"], [role="textbox"], textarea, input[type="text"]',
//           )
//           .first()
//           .isVisible({ timeout: 200 })
//           .catch(() => false);
//         if (!hasInput) continue;

//         return el;
//       }
//     }
//     return null;
//   };

//   const getChatbotOverlay = async (): Promise<Locator | null> => {
//     return getActiveRecruiterContainer();
//   };

//   const getChatbotOverlayFromInput = async (
//     input: Locator,
//   ): Promise<Locator | null> => {
//     const xpath = [
//       'ancestor::div[contains(@class, "chatbot_Drawer")]',
//       'ancestor::div[contains(@id, "ChatbotContainer")]',
//       'ancestor::div[contains(@class, "chatbot_DrawerContentWrapper")]',
//     ].join(" | ");

//     const overlay = input.locator(`xpath=${xpath}`);
//     return (await overlay.count()) > 0 ? overlay.first() : null;
//   };

//   const isRecruiterFlowVisible = async (timeout = 3000): Promise<boolean> => {
//     // Explicitly look for the drawer / message container instead of a broad
//     // modal sweep, so backdrops don't count as "visible flow".
//     const selectors = [
//       ".chatbot_Drawer",
//       ".chatbot_MessageContainer",
//       '[id$="ChatbotContainer"]',
//       '[class*="chatbot_DrawerContentWrapper" i]',
//     ].join(", ");

//     const elements = page.locator(selectors);
//     const count = await elements.count().catch(() => 0);

//     for (let i = 0; i < count; i++) {
//       if (await elements.nth(i).isVisible({ timeout }).catch(() => false)) {
//         return true;
//       }
//     }
//     return false;
//   };

//   // ─────────────────────────────────────────────────────────────
//   // ── QUESTION READING (rewritten) ─────────────────────────────
//   // Questions live in: .chatbot_MessageContainer li.botItem .botMsg span
//   // ─────────────────────────────────────────────────────────────
//   const getVisibleQuestion = async (): Promise<string> => {
//     const container = await getActiveRecruiterContainer();
//     const scope = container ?? page;

//     // Most specific first
//     const candidates = [
//       ".chatbot_MessageContainer li.botItem .botMsg span",
//       "li.botItem .botMsg span",
//       ".botMsg span",
//       "li.botItem .botMsg",
//       ".botMsg",
//     ];

//     const texts: string[] = [];

//     for (const selector of candidates) {
//       const els = scope.locator(selector);
//       const count = await els.count().catch(() => 0);
//       if (count === 0) continue;

//       for (let i = 0; i < count; i++) {
//         const el = els.nth(i);
//         const visible = await el.isVisible({ timeout: 150 }).catch(() => false);
//         if (!visible) continue;

//         const text = ((await el.textContent().catch(() => "")) || "").trim();
//         if (!text || text.length < 5 || text.length > 500) continue;
//         if (isGreeting(text)) continue;

//         texts.push(text);
//       }

//       if (texts.length > 0) break; // Prefer the most specific selector that yielded results
//     }

//     // Return the bottom-most / most recent question
//     return texts.at(-1) ?? "";
//   };

//   // ─────────────────────────────────────────────────────────────
//   // ── INPUT DETECTION (rewritten) ──────────────────────────────
//   // Input is: div.textArea[contenteditable="true"][data-placeholder]
//   // ─────────────────────────────────────────────────────────────
//   const isEditable = async (loc: Locator): Promise<boolean> => {
//     const visible = await loc.isVisible({ timeout: 150 }).catch(() => false);
//     if (!visible) return false;
//     const enabled = await loc.isEnabled().catch(() => false);
//     if (!enabled) return false;

//     return loc
//       .evaluate((el) => {
//         if (el instanceof HTMLInputElement) {
//           return (
//             !el.disabled &&
//             !el.readOnly &&
//             ["text", "search", "tel", "url", "email"].includes(
//               el.type.toLowerCase(),
//             )
//           );
//         }
//         if (el instanceof HTMLTextAreaElement) {
//           return !el.disabled && !el.readOnly;
//         }
//         if (el instanceof HTMLElement) return el.isContentEditable;
//         return false;
//       })
//       .catch(() => false);
//   };

//   const getTextInput = async (): Promise<Locator | null> => {
//     const container = await getActiveRecruiterContainer();

//     // Priority order — contenteditable divs first (they are what Naukri uses now)
//     const knownSelectors = [
//       'div[contenteditable="true"][data-placeholder]',
//       'div.textArea[contenteditable="true"]',
//       '[class*="textArea"][contenteditable="true"]',
//       'div[contenteditable="true"]',
//       '[role="textbox"]',
//       'textarea[placeholder*="message" i]',
//       'input[placeholder*="message" i]',
//     ];

//     // Pass 1: inside the chat container
//     if (container) {
//       for (const selector of knownSelectors) {
//         const candidates = container.locator(selector);
//         const count = await candidates.count().catch(() => 0);
//         for (let i = 0; i < count; i++) {
//           const input = candidates.nth(i);
//           if (await isEditable(input)) {
//             logger.debug({ selector, scope: "container" }, "Chatbot input found");
//             return input;
//           }
//         }
//       }
//     }

//     // Pass 2: full page — safe because contenteditable[data-placeholder] is very specific
//     for (const selector of knownSelectors) {
//       const candidates = page.locator(selector);
//       const count = await candidates.count().catch(() => 0);
//       for (let i = 0; i < count; i++) {
//         const input = candidates.nth(i);
//         // Skip the search bar's contenteditable inputs
//         const placeholder = (
//           (await input.getAttribute("data-placeholder").catch(() => "")) ||
//           (await input.getAttribute("placeholder").catch(() => "")) ||
//           ""
//         ).toLowerCase();
//         if (/keyword|location|search/i.test(placeholder)) continue;

//         if (await isEditable(input)) {
//           logger.debug({ selector, scope: "page" }, "Chatbot input found");
//           return input;
//         }
//       }
//     }

//     logger.warn("No chatbot input found");
//     return null;
//   };

 

// //   const getVisibleRadioOptions = async (): Promise<RadioOption[]> => {
// //     const container = await getActiveRecruiterContainer();
// //     if (!container) return [];

// //     // Options live alongside the most recent question (last li.botItem
// //     // OR directly inside .chatbot_MessageContainer if the HTML differs)
// //     const scopes = [
// //       container.locator("li.botItem").last(),
// //       container.locator(".chatbot_MessageContainer").last(),
// //       container,
// //     ];

// //     const options: RadioOption[] = [];

// //     for (const scope of scopes) {
// //       const inputs = scope.locator('input[type="radio"], input[type="checkbox"]');
// //       const count = await inputs.count().catch(() => 0);
// //       if (count === 0) continue;

// //       for (let i = 0; i < count; i++) {
// //         const radio = inputs.nth(i);
// //         const visible = await radio.isVisible({ timeout: 150 }).catch(() => false);
// //         if (!visible) continue;

// //         // Resolve the label text
// //         const id = await radio.getAttribute("id").catch(() => null);
// //         let text = "";
// //         if (id) {
// //           text = ((await container.locator(`label[for="${id}"]`).first().textContent().catch(() => "")) || "").trim();
// //         }
// //         if (!text) {
// //           text = ((await radio.evaluate((el) => {
// //             const wrap = el.closest('[class*="radio"], [class*="option"], label') || el.parentElement;
// //             return wrap?.textContent ?? "";
// //           }).catch(() => "")) || "").trim();
// //         }

// //         if (text) options.push({ text: text.replace(/\s+/g, " "), locator: radio });
// //       }

// //       if (options.length > 0) break;
// //     }

// //     return options;
// //   };

// //   const chooseBestRadioOption = (
// //     options: RadioOption[],
// //     question: string,
// //     suggestedAnswer: string,
// //   ): RadioOption | null => {
// //     if (options.length === 0) return null;

// //     const q = normalize(question);
// //     const ans = normalize(suggestedAnswer);

// //     // 1. Direct match against suggested answer
// //     for (const o of options) {
// //       const n = normalize(o.text);
// //       if (n && (n === ans || ans.includes(n) || n.includes(ans))) return o;
// //     }

// //     // 2. Numeric range that contains our years
// //     const years = profile.professional.totalExperienceYears ?? 0;
// //     for (const o of options) {
// //       const t = o.text.toLowerCase();
// //       const range = t.match(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)/);
// //       if (range) {
// //         const lo = Number(range[1]);
// //         const hi = Number(range[2]);
// //         if (years >= lo && years <= hi) return o;
// //       }
// //       const above = t.match(/(\d+(?:\.\d+)?)\s*(?:yrs?|\+)\s*and above/i);
// //       if (above) {
// //         const lo = Number(above[1]);
// //         if (years >= lo) return o;
// //       }
// //     }

// //     // 3. Skill-specific preferences — MERN / Node / React match our profile
// //     for (const o of options) {
// //       if (/\bmern\b|node|react|full ?stack|javascript|typescript/i.test(o.text)) return o;
// //     }

// //     // 4. Yes preference
// //     for (const o of options) {
// //       if (/^\s*yes\b/i.test(o.text)) return o;
// //     }

// //     // 5. Fallback — first option (better than infinite wait)
// //     return options[0];
// //   };

// //   const clickRadioOption = async (option: RadioOption): Promise<void> => {
// //     await option.locator.scrollIntoViewIfNeeded().catch(() => {});
// //     try {
// //       await option.locator.check({ force: true, timeout: 2000 });
// //     } catch {
// //       // Custom-styled radios often hide the actual <input>
// //       await option.locator
// //         .evaluate((el) => {
// //           const clickable =
// //             el.closest("label") ??
// //             el.closest('[class*="radio"]') ??
// //             el.parentElement ??
// //             el;
// //           (clickable as HTMLElement).click();
// //         })
// //         .catch(() => {});
// //     }
// //     await page.waitForTimeout(250);
// //   };

//   // ─────────────────────────────────────────────────────────────
//   // ── SUBMIT BUTTON CLICK (rewritten) ──────────────────────────
//   // Save is: <div class="sendMsg" tabindex="0">Save</div>
//   // ─────────────────────────────────────────────────────────────
  
//   // ── RADIO / CHECKBOX OPTION SUPPORT ──────────────────────────

// const getVisibleChoiceOptions = async (): Promise<ChoiceOption[]> => {
//   const container = await getActiveRecruiterContainer();
//   if (!container) return [];

//   const options: ChoiceOption[] = [];

//   for (const kind of ["checkbox", "radio"] as const) {
//     // Naukri hides the real <input> (display:none) and shows a styled label.
//     // So DO NOT filter by isVisible() — filter by the label being visible.
//     const inputs = container.locator(`input[type="${kind}"]`);
//     const count = await inputs.count().catch(() => 0);
//     if (count === 0) continue;

//     for (let i = 0; i < count; i++) {
//       const input = inputs.nth(i);

//       // Resolve the visible label via `for=` first.
//       const id = await input.getAttribute("id").catch(() => null);
//       let labelText = "";
//       let labelLocator: Locator | null = null;

//       if (id) {
//         const label = container.locator(`label[for="${id}"]`).first();
//         const labelVisible = await label
//           .isVisible({ timeout: 150 })
//           .catch(() => false);
//         if (labelVisible) {
//           labelText =
//             ((await label.textContent().catch(() => "")) || "").trim();
//           labelLocator = label;
//         }
//       }

//       // Fallback: read text from the wrapping container's label sibling
//       if (!labelText) {
//         const wrapped = input.locator(
//           'xpath=ancestor::*[self::div or self::li][1]',
//         );
//         const wrappedLabel = wrapped.locator("label").first();
//         const wrappedVisible = await wrappedLabel
//           .isVisible({ timeout: 150 })
//           .catch(() => false);
//         if (wrappedVisible) {
//           labelText =
//             ((await wrappedLabel.textContent().catch(() => "")) || "").trim();
//           labelLocator = wrappedLabel;
//         }
//       }

//       // Last-ditch fallback: the input itself carries an aria-label / value
//       if (!labelText) {
//         labelText =
//           (await input.getAttribute("aria-label").catch(() => null)) ||
//           (await input.getAttribute("value").catch(() => null)) ||
//           "";
//       }

//       if (!labelText) continue;

//       options.push({
//         text: labelText.replace(/\s+/g, " "),
//         locator: labelLocator ?? input,
//         kind,
//         input,
//       });
//     }

//     if (options.length > 0) break; // prefer checkbox; only fall to radio if none found
//   }

//   return options;
// };

// /**
//  * Picks the best option(s) for a question.
//  * Radios → single best match.
//  * Checkboxes → every option whose text overlaps our city/skill list.
//  */
// // const chooseOptions = (
// //   options: ChoiceOption[],
// //   question: string,
// //   suggestedAnswer: string,
// // ): ChoiceOption[] => {
// //   if (options.length === 0) return [];

// //   const q = normalize(question);
// //   const ans = normalize(suggestedAnswer);

// //   // Match configured multi-answer text such as "Delhi, Noida and Remote".
// //   // Radios use the first match; checkboxes keep every matching option.
// //   const answerParts = ans
// //     .split(/,|\s+and\s+|\s+or\s+/i)
// //     .map((part) => part.trim())
// //     .filter(Boolean);
// //   const answerMatches = options.filter((option) => {
// //     const optionText = normalize(option.text);
// //     return answerParts.some(
// //       (part) =>
// //         optionText === part ||
// //         optionText.includes(part) ||
// //         part.includes(optionText),
// //     );
// //   });
// //   if (answerMatches.length > 0) {
// //     return options[0].kind === "checkbox"
// //       ? answerMatches
// //       : [answerMatches[0]];
// //   }

// //   // Chat experience choices are usually whole years (1, 2, 3, ...), while
// //   // the profile stores fractional experience such as "2.9 years".
// //   if (isExperienceQuestion(q) || /\d+(?:\.\d+)?\s*(?:years?|yrs?)/i.test(ans)) {
// //     const targetYears = Math.max(
// //       0,
// //       Math.floor(profile.professional.totalExperienceYears ?? 0),
// //     );
// //     const exactYears = options.find((option) => {
// //       const text = normalize(option.text);
// //       return new RegExp(`^${targetYears}\\s*(?:years?|yrs?)?$`, "i").test(text);
// //     });
// //     if (exactYears) return [exactYears];
// //   }

// //   // ── Checkbox path: multi-select ─────────────────────────────
// //   if (options[0].kind === "checkbox") {
// //     const isCityQuestion =
// //       q.includes("city") ||
// //       q.includes("residing") ||
// //       q.includes("relocate") ||
// //       q.includes("location") ||
// //       q.includes("based");

// //     if (isCityQuestion) {
// //       // Build the set of cities the candidate is OK with.
// //       const cityPool = [
// //         profile.personal.currentLocation,
// //         ...profile.personal.preferredLocations,
// //       ]
// //         .map((c) => normalize(c ?? ""))
// //         .filter(Boolean);

// //       const picks: ChoiceOption[] = [];
// //       for (const opt of options) {
// //         const n = normalize(opt.text);
// //         if (cityPool.some((city) => n.includes(city) || city.includes(n))) {
// //           picks.push(opt);
// //         }
// //       }
// //       if (picks.length > 0) return picks;

// //       // No city matched → pick the first option (better than skipping).
// //       return [options[0]];
// //     }

// //     // Generic multi-select: fall back to skill overlap
// //     const skills = (profile.professional.skills ?? []).map((s) => normalize(s));
// //     const picks = options.filter((opt) => {
// //       const n = normalize(opt.text);
// //       return skills.some((s) => n.includes(s));
// //     });
// //     if (picks.length > 0) return picks;
// //     return [options[0]];
// //   }

// //   // ── Radio path: single-select (existing logic) ──────────────
// //   for (const o of options) {
// //     const n = normalize(o.text);
// //     if (n && (n === ans || ans.includes(n) || n.includes(ans))) return [o];
// //   }

// //   const years = profile.professional.totalExperienceYears ?? 0;
// //   for (const o of options) {
// //     const t = o.text.toLowerCase();
// //     const range = t.match(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)/);
// //     if (range) {
// //       const lo = Number(range[1]);
// //       const hi = Number(range[2]);
// //       if (years >= lo && years <= hi) return [o];
// //     }
// //     const above = t.match(/(\d+(?:\.\d+)?)\s*(?:yrs?|\+)\s*and above/i);
// //     if (above) {
// //       const lo = Number(above[1]);
// //       if (years >= lo) return [o];
// //     }
// //   }

// //   for (const o of options) {
// //     if (/\bmern\b|node|react|full ?stack|javascript|typescript/i.test(o.text)) {
// //       return [o];
// //     }
// //   }

// //   for (const o of options) {
// //     if (/^\s*yes\b/i.test(o.text)) return [o];
// //   }

// //   return [options[0]];
// // };


// /**
//  * Generic option matcher for ANY radio/checkbox question.
//  * Strategy order (most specific → most generic):
//  *  1. Exact normalized match with the resolved answer
//  *  2. Answer-parts match (answer "Delhi, Noida" ↔ option "Noida / Delhi")
//  *  3. Numeric-range match (experience, CTC, notice period)
//  *  4. Yes/No detection (question is yes/no → pick Yes/No)
//  *  5. Domain heuristics (skills, education, shift, relocation, etc.)
//  *  6. "None of above" / "Other" fallback only if nothing else matched
//  *  7. First option as last resort
//  */
// const chooseOptions = (
//   options: ChoiceOption[],
//   question: string,
//   suggestedAnswer: string,
// ): ChoiceOption[] => {
//   if (options.length === 0) return [];

//   const q = normalize(question);
//   const ans = normalize(suggestedAnswer);
//   const isCheckbox = options[0].kind === "checkbox";
//   const wrap = (picks: ChoiceOption[]) =>
//     isCheckbox ? picks : picks.slice(0, 1);

//   // ── 0. Split options into "real" vs "fallback" (None/Other/N/A) ──
//   const isFallbackOption = (t: string) =>
//     /^(none|none of (the )?above|other|others|n\/?a|not applicable|prefer not to say|no preference|any|all of the above)\b/i.test(
//       t.trim(),
//     );

//   const realOptions = options.filter((o) => !isFallbackOption(o.text));
//   const fallbackOptions = options.filter((o) => isFallbackOption(o.text));

//   const pickFrom = (pool: ChoiceOption[]) =>
//     pool.length > 0 ? pool : options;

//   // ── 1. Exact / substring match with the resolved answer ─────
//   if (ans && ans !== "n/a") {
//     const exact = pickFrom(realOptions).filter((o) => {
//       const n = normalize(o.text);
//       return n === ans || n.includes(ans) || ans.includes(n);
//     });
//     if (exact.length > 0) {
//       logger.debug({ matched: exact.map((o) => o.text) }, "Option matched: exact answer");
//       return wrap(exact);
//     }

//     // 1b. Multi-part answer ("Delhi, Noida and Remote") ↔ option text
//     const answerParts = ans
//       .split(/,|\s+and\s+|\s+or\s+|\/|\|/i)
//       .map((p) => p.trim())
//       .filter((p) => p.length > 1);

//     if (answerParts.length > 0) {
//       const partMatches = pickFrom(realOptions).filter((o) => {
//         const n = normalize(o.text);
//         return answerParts.some((part) => {
//           if (part.length < 2) return false;
//           const esc = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//           return new RegExp(`\\b${esc}\\b`, "i").test(n);
//         });
//       });
//       if (partMatches.length > 0) {
//         logger.debug(
//           { matched: partMatches.map((o) => o.text), answerParts },
//           "Option matched: multi-part answer",
//         );
//         return wrap(partMatches);
//       }
//     }
//   }

//   // ── 2. Numeric range match (experience, CTC, notice) ────────
//   const numericMatch = matchNumericOption(pickFrom(realOptions), q, ans);
//   if (numericMatch.length > 0) {
//     logger.debug({ matched: numericMatch.map((o) => o.text) }, "Option matched: numeric range");
//     return wrap(numericMatch);
//   }

//   // ── 3. Yes/No questions ─────────────────────────────────────
//   if (isYesNoQuestion(q) || /\b(yes|no)\b/i.test(ans)) {
//     const wantYes = !/\bno\b/i.test(ans);
//     const yn = pickFrom(realOptions).find((o) =>
//       wantYes ? /^\s*yes\b/i.test(o.text) : /^\s*no\b/i.test(o.text),
//     );
//     if (yn) {
//       logger.debug({ matched: yn.text, wantYes }, "Option matched: yes/no");
//       return wrap([yn]);
//     }
//   }

//   // ── 4. Domain heuristics ────────────────────────────────────
//   const heuristics = matchByDomainHeuristics(pickFrom(realOptions), q, ans);
//   if (heuristics.length > 0) {
//     logger.debug(
//       { matched: heuristics.map((o) => o.text) },
//       "Option matched: domain heuristic",
//     );
//     return wrap(heuristics);
//   }

//   // ── 5. Fallback option ("None of above") ────────────────────
//   if (fallbackOptions.length > 0) {
//     logger.info(
//       { picked: fallbackOptions[0].text },
//       "No real option matched — picking fallback",
//     );
//     return wrap([fallbackOptions[0]]);
//   }

//   // ── 6. Last resort: first real option ───────────────────────
//   logger.warn(
//     { picked: options[0].text, question: q, answer: ans },
//     "No match found — picking first option",
//   );
//   return wrap([options[0]]);
// };
// const clickChoiceOption = async (option: ChoiceOption): Promise<void> => {
//   await option.locator.scrollIntoViewIfNeeded().catch(() => {});

//   if (await option.input.isChecked().catch(() => false)) {
//     logger.debug({ text: option.text }, "Choice already selected");
//     return;
//   }

//   // The visible label click is what Naukri listens to.
//   try {
//     await option.locator.click({ timeout: 2500 });
//   } catch {
//     // If label click fails (rare), force-check the underlying input.
//     try {
//       await option.input.check({ force: true, timeout: 2000 });
//     } catch {
//       await option.locator
//         .evaluate((el) => {
//           const clickable =
//             el.closest("label") ??
//             el.closest('[class*="check"]') ??
//             el.closest('[class*="radio"]') ??
//             el.parentElement ??
//             el;
//           (clickable as HTMLElement).click();
//         })
//         .catch(() => {});
//     }
//   }

//   await page.waitForTimeout(200);

//   // Verify it actually checked
//   const checked = await option.input.isChecked().catch(() => false);
//   logger.debug({ text: option.text, checked }, "Choice click result");
// };
// // const clickChoiceOption = async (option: ChoiceOption): Promise<void> => {
// //   await option.locator.scrollIntoViewIfNeeded().catch(() => {});
// //   try {
// //     await option.locator.check({ force: true, timeout: 2000 });
// //   } catch {
// //     await option.locator
// //       .evaluate((el) => {
// //         const clickable =
// //           el.closest("label") ??
// //           el.closest('[class*="radio"]') ??
// //           el.closest('[class*="check"]') ??
// //           el.parentElement ??
// //           el;
// //         (clickable as HTMLElement).click();
// //       })
// //       .catch(() => {});
// //   }
// //   await page.waitForTimeout(200);
// // };



//   const clickChatbotSubmitButton = async (input: Locator): Promise<void> => {
//     const container =
//       (await getChatbotOverlayFromInput(input)) ??
//       (await getActiveRecruiterContainer());

//     const scope = container ?? page;

//     // Candidates, most specific first
//     const saveSelectors = [
//       '.sendMsg',                                  // exact class from the HTML
//       '[class*="sendMsg"]',
//       'div[tabindex="0"]:has-text("Save")',
//       'div:has-text("Save")',
//       'button:has-text("Save")',
//       'button:has-text("Submit")',
//       'button[type="submit"]',
//     ];

//     for (const selector of saveSelectors) {
//       const candidates = scope.locator(selector);
//       const count = await candidates.count().catch(() => 0);
//       for (let i = count - 1; i >= 0; i--) {
//         const btn = candidates.nth(i);
//         const visible = await btn.isVisible({ timeout: 200 }).catch(() => false);
//         if (!visible) continue;

//         const text = ((await btn.textContent().catch(() => "")) || "").trim();
//         if (selector === 'button[type="submit"]') {
//           // only accept generic submit if it visibly says Save/Submit
//           if (!/save|submit/i.test(text)) continue;
//         }

//         // Ensure the parent container isn't visibly disabled
//         const disabled = await btn
//           .evaluate((el) => {
//             const parent = el.closest('[class*="send"]');
//             if (!parent) return false;
//             return /disabled/i.test(parent.className);
//           })
//           .catch(() => false);

//         if (disabled) {
//           logger.debug({ text }, "Save button still disabled — waiting 500ms");
//           await page.waitForTimeout(500);
//         }

//         try {
//           await btn.scrollIntoViewIfNeeded().catch(() => {});
//           await btn.click({ timeout: 3000 });
//           logger.info({ selector, text }, "Chatbot Save clicked");
//           return;
//         } catch (err) {
//           logger.debug(
//             { selector, err: err instanceof Error ? err.message : String(err) },
//             "Normal click failed, trying DOM click",
//           );
//           await btn
//             .evaluate((el) => (el as HTMLElement).click())
//             .catch(() => {});
//           return;
//         }
//       }
//     }

//     // Final fallback: press Enter inside the input
//     logger.warn("No Save control found — pressing Enter inside input");
//     await input.focus().catch(() => {});
//     await input.press("Enter").catch(() => {});
//   };

//   // ─────────────────────────────────────────────────────────────
//   // ── TYPE INTO CONTENTEDITABLE ────────────────────────────────
//   // ─────────────────────────────────────────────────────────────
//   const submitTextAnswer = async (
//     input: Locator,
//     answer: string,
//   ): Promise<void> => {
//     const sanitized = sanitizeAnswerLength(answer);

//     await input.waitFor({ state: "visible", timeout: 5000 });
//     if (!(await input.isEnabled().catch(() => false))) {
//       throw new Error("Chatbot input is disabled");
//     }

//     await input.click();
//     await page.waitForTimeout(150);

//     const isContentEditable = await input
//       .evaluate((el) => el instanceof HTMLElement && el.isContentEditable)
//       .catch(() => false);

//     if (isContentEditable) {
//       // Clear then type so the send button's React state updates
//       await input.evaluate((el) => {
//         if (el instanceof HTMLElement) el.textContent = "";
//       });
//       await input.pressSequentially(sanitized, { delay: 40 });

//       // Ensure the framework's onChange fires
//       await input.evaluate((el) => {
//         el.dispatchEvent(new Event("input", { bubbles: true }));
//         el.dispatchEvent(new Event("change", { bubbles: true }));
//         el.dispatchEvent(new Event("blur", { bubbles: true }));
//       });
//     } else {
//       await input.fill("");
//       await input.fill(sanitized);
//       await input.evaluate((el) => {
//         el.dispatchEvent(new Event("input", { bubbles: true }));
//         el.dispatchEvent(new Event("change", { bubbles: true }));
//         el.dispatchEvent(new Event("blur", { bubbles: true }));
//       });
//     }

//     const entered = isContentEditable
//       ? ((await input.textContent().catch(() => "")) || "").trim()
//       : (await input.inputValue().catch(() => "")).trim();

//     if (!entered) throw new Error(`Could not type answer: "${sanitized}"`);

//     logger.info({ answer: sanitized, entered }, "Answer typed");

//     await page.waitForTimeout(500); // give React time to enable Save
//     await clickChatbotSubmitButton(input);
//   };

//   // ─────────────────────────────────────────────────────────────
//   // ── SKIP / WAIT (unchanged) ──────────────────────────────────
//   // ─────────────────────────────────────────────────────────────
//   const clickSkipQuestionButton = async (): Promise<boolean> => {
//     const selectors = [
//       'button:has-text("Skip this question")',
//       'button:has-text("Skip")',
//       'div[class*="skip"]',
//       'span:has-text("Skip")',
//     ];
//     for (const selector of selectors) {
//       const loc = page.locator(selector).first();
//       if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
//         await loc.click().catch(() => {});
//         logger.info("Skip clicked");
//         return true;
//       }
//     }
//     return false;
//   };

//   const applicationCompleted = async (): Promise<boolean> => {
//     if (await isRecruiterFlowVisible(300)) return false;

//     const body = (
//       (await page.locator("body").textContent().catch(() => "")) || ""
//     ).toLowerCase();
//     if (successPattern.test(body)) return true;

//     const appliedBtn = page.locator(
//       'button:has-text("Applied"), .applied-button, [class*="applied"]',
//     );
//     if ((await appliedBtn.count()) > 0) {
//       if (await appliedBtn.first().isVisible().catch(() => false)) return true;
//     }
//     return false;
//   };

//   const waitForQuestionChange = async (
//     previous: string,
//     timeout = 8_000, // was 15000
//   ): Promise<boolean> => {
//     const prev = normalize(previous);
//     const started = Date.now();
//     while (Date.now() - started < timeout) {
//       if (await applicationCompleted()) return true;
//       if (!(await isRecruiterFlowVisible(1000))) return false;

//       await page.waitForTimeout(500);
//       const current = await getVisibleQuestion();
//       if (current && normalize(current) !== prev) return true;
//     }
//     return false;
//   };

//   // ─────────────────────────────────────────────────────────────
//   // ── MAIN LOOP (unchanged shape, log-heavy) ───────────────────
//   // ─────────────────────────────────────────────────────────────
//   const solveCommonQuestions = async (
//     maxQuestions = 12, // was 20
//   ): Promise<SolveResult> => {
//     let answered = 0;
//     let idleAttempts = 0;
//     const unanswered: string[] = [];

//     while (answered < maxQuestions && idleAttempts < 10) { // was 300
//       const chatOpen = await isRecruiterFlowVisible(500); //500
//       if (!chatOpen && (await applicationCompleted())) {
//         return { answered, completed: true, unansweredQuestions: unanswered };
//       }

//       await page.waitForTimeout(500);

//       const question = await getVisibleQuestion();
//       if (!question) {
//         idleAttempts++;
//         logger.debug({ idleAttempts }, "No question text visible yet");
//         continue;
//       }

//       const norm = normalize(question);
//       if (answeredQuestions.has(norm)) {
//         idleAttempts++;
//         continue;
//       }

//       let answer = resolveAnswer(question);
//       if (!answer) {
//         logger.warn({ question }, "No answer in profile.json — skipping");
//         if (await clickSkipQuestionButton()) {
//           answeredQuestions.add(norm);
//           answered++;
//           idleAttempts = 0;
//           await waitForQuestionChange(question);
//           continue;
//         }
//         answer = "N/A";
//       }

//       logger.info({ question, answer }, "Answering question");

//       // ── 1. Radio / checkbox options take priority ──────────
//     //   const radioOptions = await getVisibleRadioOptions();
//     //   if (radioOptions.length > 0) {
//     //     logger.info(
//     //       { count: radioOptions.length, options: radioOptions.map((o) => o.text) },
//     //       "Multiple-choice question detected",
//     //     );

//     //     const chosen = chooseBestRadioOption(radioOptions, question, answer);
//     //     if (chosen) {
//     //       await clickRadioOption(chosen);
//     //       logger.info({ chosen: chosen.text }, "Radio option selected");
//     //     } else {
//     //       logger.warn("No suitable radio option — trying skip");
//     //       if (await clickSkipQuestionButton()) {
//     //         answeredQuestions.add(norm);
//     //         answered++;
//     //         idleAttempts = 0;
//     //         await waitForQuestionChange(q   uestion);
//     //         continue;
//     //       }
//     //     }
//       const choiceOptions = await getVisibleChoiceOptions();
//       if (choiceOptions.length > 0) {
//         logger.info(
//           {
//             count: choiceOptions.length,
//             kind: choiceOptions[0].kind,
//             options: choiceOptions.map((o) => o.text),
//           },
//           "Multiple-choice question detected",
//         );

//         const picks = chooseOptions(choiceOptions, question, answer);

//         if (picks.length === 0) {
//           logger.warn("No suitable choice — trying skip");
//           if (await clickSkipQuestionButton()) {
//             answeredQuestions.add(norm);
//             answered++;
//             idleAttempts = 0;
//             await waitForQuestionChange(question);
//             continue;
//           }
//         } else {
//           for (const pick of picks) {
//             await clickChoiceOption(pick);
//             logger.info({ picked: pick.text }, "Choice option selected");
//           }
//         }
//       // Wait for React to enable the Save button
//         await page.waitForTimeout(500); 
//         // Submit — reuse the same Save click path; pass the input locator
//         // as a fallback anchor for wantOfBetter — find any visible editable
//         const anyInput = await getTextInput().catch(() => null);
//         const anchor = anyInput ?? page.locator("body");
//         await clickChatbotSubmitButton(anchor);

//         answeredQuestions.add(norm);
//         answered++;
//         idleAttempts = 0;

//         const advancedChoice = await waitForQuestionChange(question, 8000);
//         // if (!advancedRadio) {
//         //   logger.warn({ question }, "No advance after radio submit");
//         //   const skipped = await clickSkipQuestionButton();
//         //   if (skipped) {
//         //     await waitForQuestionChange(question);
//         //     continue;
//         //   }
//         //   unanswered.push(question);
//         //   return { answered, completed: false, unansweredQuestions: unanswered };
//         // }
//          if (!advancedChoice) {
//           logger.warn({ question }, "No advance after choice submit");
//           if (await clickSkipQuestionButton()) {
//             await waitForQuestionChange(question);
//             continue;
//           }
//           unanswered.push(question);
//           return { answered, completed: false, unansweredQuestions: unanswered };
//         }
//         continue;
//       }
//       const input = await getTextInput();
//       if (!input) {
//         logger.warn({ question }, "No input found");
//         if (await clickSkipQuestionButton()) {
//           answeredQuestions.add(norm);
//           answered++;
//           idleAttempts = 0;
//           await waitForQuestionChange(question);
//           continue;
//         }
//         unanswered.push(question);
//         return { answered, completed: false, unansweredQuestions: unanswered };
//       }

//       try {
//         await submitTextAnswer(input, answer);
//       } catch (err) {
//         logger.error(
//           { question, err: err instanceof Error ? err.message : String(err) },
//           "Submit failed",
//         );
//         if (await clickSkipQuestionButton()) {
//           answeredQuestions.add(norm);
//           answered++;
//           idleAttempts = 0;
//           await waitForQuestionChange(question);
//           continue;
//         }
//         unanswered.push(question);
//         return { answered, completed: false, unansweredQuestions: unanswered };
//       }

//       answeredQuestions.add(norm);
//       answered++;
//       idleAttempts = 0;

//       const advanced = await waitForQuestionChange(question, 8000);
//       if (!advanced) {
//         logger.warn({ question }, "No advance after submit");
//         if (await clickSkipQuestionButton()) {
//           await waitForQuestionChange(question);
//           continue;
//         }
//         unanswered.push(question);
//         return { answered, completed: false, unansweredQuestions: unanswered };
//       }
//     }

//     return {
//       answered,
//       completed: await applicationCompleted(),
//       unansweredQuestions: unanswered,
//     };
//   };

//   // ─────────────────────────────────────────────────────────────
//   // ── RESUME UPLOAD (unchanged) ────────────────────────────────
//   // ─────────────────────────────────────────────────────────────
//   const uploadResumeIfNeeded = async (): Promise<boolean> => {
//     const uploadInputs = page.locator('input[type="file"]');
//     const count = await uploadInputs.count();
//     if (count === 0) return false;

//     const resumePath = profile.resume.path;
//     if (!resumePath) {
//       logger.warn("Resume path missing");
//       return false;
//     }
//     const absolutePath = path.isAbsolute(resumePath)
//       ? resumePath
//       : path.resolve(process.cwd(), resumePath);

//     for (let i = 0; i < count; i++) {
//       const inp = uploadInputs.nth(i);
//       const visible = await inp.isVisible({ timeout: 300 }).catch(() => false);
//       if (!visible) continue;

//       const isChatInput = await inp
//         .evaluate(
//           (el) =>
//             el.closest(
//               '.chatbot_Drawer, .chatbot_Modal, [id$="ChatbotContainer"], [role="dialog"]',
//             ) !== null,
//         )
//         .catch(() => false);
//       if (isChatInput) continue;

//       await inp.setInputFiles(absolutePath);
//       logger.info({ resumePath: absolutePath }, "Resume uploaded");
//       return true;
//     }

//     logger.warn("Resume upload skipped (only chat inputs found)");
//     return false;
//   };

//   return {
//     resolveAnswer,
//     solveCommonQuestions,
//     uploadResumeIfNeeded,
//     applicationCompleted,
//   };
// };
  