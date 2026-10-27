const CONCEPTS = [
  {
    name: "mind-bending",
    terms: /\b(mind[- ]?bending|twisty|thought[- ]?provoking|surreal|trippy)\b/,
    genres: ["sci-fi", "mystery", "psychological", "fantasy", "philosophical"],
    clues: ["dream", "reality", "identity", "time", "memory", "perception", "simulation", "consciousness", "parallel", "twist"],
  },
  {
    name: "psychological thriller",
    terms: /\b(psychological|disturbing|unsettling|dark|intense|thriller|suspenseful|suspense)\b/,
    genres: ["psychological thriller", "thriller", "crime", "mystery", "horror"],
    clues: ["obsession", "paranoia", "murder", "deception", "fear", "violence", "twist"],
  },
  {
    name: "emotional",
    terms: /\b(cry|weep|tearjerker|sad|heartbreaking|emotional|moving|touching)\b/,
    genres: ["drama", "family", "romance", "war"],
    clues: ["love", "loss", "grief", "friendship", "redemption", "sacrifice", "compassion", "family", "hope", "heart"],
  },
  {
    name: "feel-good",
    terms: /\b(feel[- ]?good|uplifting|cheerful|comforting|happy|funny|lighthearted|feel good)\b/,
    genres: ["comedy", "adventure", "animation", "family", "romance"],
    clues: ["friendship", "joy", "hope", "love", "comedy", "uplifting", "heartwarming"],
  },
  {
    name: "science fiction",
    terms: /\b(sci[- ]?fi|science fiction|space|futuristic|aliens?)\b/,
    genres: ["sci-fi", "science fiction", "space"],
    clues: ["space", "future", "alien", "robot", "technology", "planet", "time"],
  },
  {
    name: "action",
    terms: /\b(action|adrenaline|fast[- ]?paced|adventure|explosive)\b/,
    genres: ["action", "adventure"],
    clues: ["battle", "fight", "chase", "war", "escape"],
  },
];

const STOP_WORDS = new Set([
  "a", "about", "after", "also", "an", "and", "anything", "before", "between", "but", "could",
  "for", "from", "give", "how", "i", "into", "like", "me", "movie", "movies", "of", "or",
  "other", "only", "should", "since", "some", "something", "that", "the", "their", "them",
  "there", "then", "through", "to", "until", "want", "watch", "what", "when", "where", "which",
  "while", "who", "with", "would", "you",
]);

const EXAMPLES = [
  "Something mind-bending like Inception",
  "A disturbing psychological thriller",
  "A great movie under 100 minutes",
  "Something that will make me cry",
];

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseRuntimeLimit(query) {
  const strictMatch = query.match(/\b(?:under|less than|below)\s*(\d{2,3})\s*(?:minutes?|mins?)?\b/);
  if (strictMatch) return { minutes: Number(strictMatch[1]), inclusive: false };
  const inclusiveMatch = query.match(/\b(?:within|at most|no more than|max(?:imum)?(?: of)?)\s*(\d{2,3})\s*(?:minutes?|mins?)?\b/)
    || query.match(/\b(\d{2,3})\s*(?:minutes?|mins?)\s*(?:or less|or under|max)\b/);
  return inclusiveMatch ? { minutes: Number(inclusiveMatch[1]), inclusive: true } : null;
}

function runtimeOf(film) {
  const match = film.runtime?.match(/\d{2,3}/);
  return match ? Number(match[0]) : null;
}

function ratingOf(film) {
  const match = film.rating?.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
  return match ? Number(match[1]) : 0;
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function findReferenceFilm(query, films) {
  const comparison = /\b(like|similar to|in the style of|if i liked|reminds me of)\b/.test(query);
  if (!comparison) return null;
  return films
    .filter((film) => query.includes(normalize(film.title)))
    .sort((left, right) => right.title.length - left.title.length)[0] ?? null;
}

function scoreFilm(film, query, plan) {
  const runtime = runtimeOf(film);
  if (plan.runtimeLimit && (
    runtime === null
    || runtime > plan.runtimeLimit.minutes
    || (!plan.runtimeLimit.inclusive && runtime === plan.runtimeLimit.minutes)
  )) return null;

  const synopsis = normalize(film.synopsis);
  const metadata = normalize(`${film.title} ${film.genres.join(" ")} ${film.synopsis}`);
  const matchedGenres = new Map();
  const matchedClues = new Set();
  let score = plan.runtimeLimit ? 1.2 : 0;
  const addGenre = (genre) => matchedGenres.set(normalize(genre), genre);

  for (const concept of plan.concepts) {
    const genreHits = film.genres.filter((entry) =>
      concept.genres.some((genre) => normalize(entry).includes(normalize(genre))),
    );
    const clueHits = concept.clues.filter((clue) => synopsis.includes(normalize(clue)));
    genreHits.forEach(addGenre);
    clueHits.forEach((clue) => matchedClues.add(clue));
    score += Math.min(genreHits.length, 2) * 1.1 + Math.min(clueHits.length, 2) * 0.55;
  }

  for (const genre of plan.directGenres) {
    const genreHit = film.genres.find((entry) => normalize(entry).includes(normalize(genre)));
    if (genreHit) {
      addGenre(genreHit);
      score += 1.2;
    }
  }

  if (plan.reference && film.id !== plan.reference.id) {
    const sharedGenres = plan.reference.genres.filter((genre) => {
      const targetGenre = film.genres.find((entry) => normalize(entry) === normalize(genre));
      if (targetGenre) addGenre(targetGenre);
      return targetGenre;
    });
    score += Math.min(sharedGenres.length, 2) * 1.1;
    const referenceProfile = normalize(plan.reference.title) === "inception"
      ? {
          genres: ["sci-fi", "thriller"],
          clues: ["dream", "reality", "identity", "time", "memory", "perception", "illusion", "deception", "subconscious", "simulation", "consciousness", "heist"],
        }
      : {
          genres: plan.reference.genres,
          clues: tokens(plan.reference.synopsis).filter((token) => token.length > 4),
        };
    const profileGenreHits = film.genres.filter((entry) =>
      referenceProfile.genres.some((genre) => normalize(entry).includes(normalize(genre))),
    );
    profileGenreHits.forEach(addGenre);
    const profileClueHits = referenceProfile.clues.filter((clue) => synopsis.includes(normalize(clue))).slice(0, 3);
    profileClueHits.forEach((clue) => matchedClues.add(clue));
    score += Math.min(profileGenreHits.length, 2) * 0.3 + profileClueHits.length * 0.75;
  }

  const queryTokens = tokens(query);
  const exactTermHits = queryTokens.filter((token) => metadata.includes(token));
  score += Math.min(new Set(exactTermHits).size, 4) * 0.25;

  if (plan.runtimeLimit && runtime !== null) {
    score += 0.2;
  }

  return {
    film,
    score: score + ratingOf(film) / 100,
    matchedGenres: [...matchedGenres.values()],
    matchedClues: [...matchedClues],
    runtime,
    rating: ratingOf(film),
    hasMoodSignal: matchedGenres.size > 0 || matchedClues.size > 0,
  };
}

function verdictFor(match, plan) {
  if (plan.runtimeOnly && match.runtime !== null && match.rating >= 8) return "WATCH";
  if (match.score >= 3.1) return "WATCH";
  if (match.score >= 1.35) return "MAYBE";
  return "SKIP";
}

function explainMatch(match, plan) {
  const reasons = [];
  const genres = match.matchedGenres.slice(0, 2);
  if (genres.length) reasons.push(`Its ${genres.join(" and ")} genre${genres.length > 1 ? "s" : ""} fit your request`);

  const clues = match.matchedClues.slice(0, 2);
  if (clues.length) reasons.push(`the synopsis includes ${clues.join(" and ")}`);

  if (plan.reference) {
    const shared = plan.reference.genres.filter((genre) =>
      match.film.genres.some((candidate) => normalize(candidate) === normalize(genre)),
    );
    if (shared.length) reasons.push(`it shares ${shared.slice(0, 2).join(" and ")} with ${plan.reference.title}`);
  }

  if (plan.runtimeLimit) {
    const operator = plan.runtimeLimit.inclusive ? "≤" : "<";
    reasons.push(`${match.runtime} min fits your ${operator}${plan.runtimeLimit.minutes}-minute limit`);
  }
  if (reasons.length === 0) reasons.push("the archive has limited metadata matching that description");
  return `${reasons.join("; ")}.`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function verdictClass(verdict) {
  return verdict.toLowerCase();
}

function renderNoMatch(output, query, hasRuntimeLimit) {
  const runtimeMessage = hasRuntimeLimit
    ? "No film in the archive fits that runtime limit."
    : "I couldn't find a confident match in this archive.";
  output.innerHTML = `
    <article class="smart-result smart-result-skip">
      <div class="smart-result-topline"><span class="smart-verdict skip">SKIP</span><span class="smart-result-label">No confident pick</span></div>
      <h3>Try a different prompt</h3>
      <p>${escapeHtml(runtimeMessage)} Try describing a mood, genre, reference film, or a different runtime.</p>
      <span class="smart-prompt-echo">${escapeHtml(query)}</span>
    </article>`;
}

function renderRecommendations(output, query, matches, plan) {
  const top = matches[0];
  if (!top || !top.hasMoodSignal && !plan.runtimeOnly && !plan.reference) {
    renderNoMatch(output, query, plan.runtimeLimit !== null);
    return;
  }

  const verdict = verdictFor(top, plan);
  const film = top.film;
  const alternatives = matches.slice(1, 3).filter((match) => match.score > 0.8);
  output.innerHTML = `
    <article class="smart-result smart-result-${verdictClass(verdict)}">
      <div class="smart-result-topline">
        <span class="smart-verdict ${verdictClass(verdict)}">${verdict}</span>
        <span class="smart-result-label">Your archive pick</span>
        <span class="smart-match-meta">${escapeHtml(String(film.year ?? ""))}${top.runtime ? ` · ${top.runtime} min` : ""}</span>
      </div>
      <div class="smart-film-layout">
        <div class="smart-film-copy">
          <h3>${escapeHtml(film.title)}</h3>
          <p class="smart-film-byline">${escapeHtml(film.director)}${film.genres.length ? ` · ${escapeHtml(film.genres.slice(0, 3).join(" / "))}` : ""}</p>
          <p class="smart-explanation">${escapeHtml(explainMatch(top, plan))}</p>
          <p class="smart-synopsis">${escapeHtml(film.synopsis)}</p>
          <button type="button" class="smart-open-film">Find this film in the archive <span aria-hidden="true">↗</span></button>
        </div>
        ${film.rating ? `<div class="smart-rating">${escapeHtml(film.rating.split(" ")[0])}<small>IMDb</small></div>` : ""}
      </div>
      ${alternatives.length ? `<div class="smart-alternatives"><span>ALSO IN THE REEL</span>${alternatives.map((match) => `
        <button type="button" class="smart-alternative" data-film-id="${escapeHtml(match.film.id)}">
          <span>${escapeHtml(match.film.title)}</span><span>${escapeHtml(match.film.genres.slice(0, 2).join(" / "))}</span>
        </button>`).join("")}</div>` : ""}
      <p class="smart-disclaimer">Matched locally from this archive's genres, synopsis, and runtime.</p>
    </article>`;

  output.querySelector(".smart-open-film")?.addEventListener("click", () => openArchiveSearch(film.title));
  output.querySelectorAll(".smart-alternative").forEach((button) => {
    button.addEventListener("click", () => {
      const alternative = matches.find((match) => match.film.id === button.dataset.filmId);
      if (alternative) renderRecommendations(output, query, [alternative, ...matches.filter((match) => match !== alternative)], plan);
    });
  });
}

function openArchiveSearch(title) {
  const searchButton = [...document.querySelectorAll("header button")]
    .find((button) => button.textContent.toLowerCase().includes("search"));
  if (!searchButton) return;
  searchButton.click();

  window.setTimeout(() => {
    const input = document.querySelector('input[placeholder^="Search films by title"]');
    if (!input) return;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }, 50);
}

function buildPlan(query, films) {
  const reference = findReferenceFilm(query, films);
  const concepts = CONCEPTS.filter((concept) => concept.terms.test(query));
  const directGenres = [...new Map(films.flatMap((film) => film.genres).map((genre) => [normalize(genre), genre])).values()]
    .filter((genre) => query.includes(normalize(genre)));
  const runtimeLimit = parseRuntimeLimit(query);
  return {
    concepts,
    directGenres,
    reference,
    runtimeLimit,
    runtimeOnly: runtimeLimit !== null && concepts.length === 0 && directGenres.length === 0 && !reference,
  };
}

function getMatches(query, films) {
  const normalizedQuery = normalize(query);
  const plan = buildPlan(normalizedQuery, films);
  const ranked = films
    .map((film) => scoreFilm(film, normalizedQuery, plan))
    .filter((match) => match !== null)
    .sort((left, right) => right.score - left.score || right.rating - left.rating);
  return { plan, ranked };
}

function mountWidget(root) {
  const header = root.querySelector("header");
  if (!header || document.getElementById("smart-watch-or-skip")) return false;

  const topNav = document.createElement("nav");
  topNav.id = "cinema-top-nav";
  topNav.className = "cinema-top-nav";
  topNav.setAttribute("aria-label", "Main");
  topNav.innerHTML = `
    <a class="cinema-top-link" href="#smart-watch-or-skip" data-cinema-action="smart" aria-label="Discover films with a mood-based recommendation">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2.8 1.8 6.4 6.4 1.8-6.4 1.8-1.8 6.4-1.8-6.4-6.4-1.8 6.4-1.8L12 2.8Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg><span>Discover</span>
    </a>
    <a class="cinema-top-link" href="#cinema-movies" data-cinema-action="archive" aria-current="location">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v5.3m0 6.4v5.3M3.5 12h5.3m6.4 0h5.3"/></svg><span>Movies</span>
    </a>
    <a class="cinema-top-link" href="#cinema-genres" data-cinema-action="genres">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5h16M4 12h16M4 18.5h16"/><circle cx="8" cy="5.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="12" r="1.5" fill="currentColor"/><circle cx="10.5" cy="18.5" r="1.5" fill="currentColor"/></svg><span>Genres</span>
    </a>
    <button type="button" class="cinema-top-link cinema-top-search" data-cinema-action="search" aria-label="Search films">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 4.2 4.2"/></svg><span>Search</span><kbd>⌘K</kbd>
    </button>`;

  const rail = document.createElement("nav");
  rail.id = "cinema-rail";
  rail.className = "cinema-rail";
  rail.setAttribute("aria-label", "Cinema tools");
  rail.innerHTML = `
    <span class="cinema-rail-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="16.5" stroke="currentColor"/><circle cx="20" cy="20" r="6.5" stroke="currentColor"/><circle cx="20" cy="20" r="2" fill="currentColor"/></svg>
    </span>
    <button type="button" class="cinema-rail-button is-active" data-cinema-action="archive" aria-current="location" aria-label="Movie archive" title="Movie archive">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v5.3m0 6.4v5.3M3.5 12h5.3m6.4 0h5.3"/></svg><span>Archive</span>
    </button>
    <button type="button" class="cinema-rail-button" data-cinema-action="smart" aria-label="Smart recommendations" title="Smart recommendations">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2.8 1.8 6.4 6.4 1.8-6.4 1.8-1.8 6.4-1.8-6.4-6.4-1.8 6.4-1.8L12 2.8Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg><span>Smart pick</span>
    </button>
    <button type="button" class="cinema-rail-button" data-cinema-action="search" aria-label="Search films" title="Search films">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 4.2 4.2"/></svg><span>Search</span>
    </button>`;

  const section = document.createElement("section");
  section.id = "smart-watch-or-skip";
  section.className = "smart-watch-or-skip";
  section.setAttribute("aria-labelledby", "smart-heading");
  section.innerHTML = `
    <div class="smart-heading-row">
      <div>
        <span class="smart-eyebrow">YOUR MOOD, YOUR NEXT MOVIE</span>
        <h2 id="smart-heading">Smart Watch Or Skip <span>AI</span></h2>
        <p>Tell us what you feel like watching. We’ll find the right reel in the archive.</p>
      </div>
      <span class="smart-local-badge"><span aria-hidden="true">✦</span> PRIVATE · RUNS LOCALLY</span>
    </div>
    <form class="smart-form">
      <label class="smart-sr-only" for="smart-prompt">Describe the movie you want to watch</label>
      <input id="smart-prompt" name="prompt" type="text" autocomplete="off" maxlength="240" placeholder="A mind-bending movie like Inception…" required>
      <button type="submit">Find my film <span aria-hidden="true">→</span></button>
    </form>
    <div class="smart-examples" aria-label="Try a prompt">
      <span>TRY</span>
      ${EXAMPLES.map((example) => `<button type="button" class="smart-example">${escapeHtml(example)}</button>`).join("")}
    </div>
    <div class="smart-output" aria-live="polite" aria-atomic="true"></div>`;

  header.insertAdjacentElement("afterend", topNav);
  topNav.insertAdjacentElement("afterend", rail);
  rail.insertAdjacentElement("afterend", section);
  root.querySelector("main")?.setAttribute("id", "cinema-movies");
  const genreDock = root.querySelector(":scope > footer");
  genreDock?.setAttribute("id", "cinema-genres");
  root.querySelector(":scope > footer")?.classList.remove("left-1/2", "-translate-x-1/2");
  const form = section.querySelector(".smart-form");
  const input = section.querySelector("#smart-prompt");
  const output = section.querySelector(".smart-output");
  let films = null;
  const movieArchive = root.querySelector("main");
  let featuredHero = null;
  let featuredStatus = null;
  let watchlist = new Set();
  let renderFeaturedMovie = () => {};

  if (movieArchive) {
    featuredHero = document.createElement("article");
    featuredHero.id = "cinema-featured-hero";
    featuredHero.className = "cinema-featured-hero";
    featuredHero.setAttribute("aria-labelledby", "cinema-featured-title");
    featuredHero.hidden = true;
    featuredHero.innerHTML = `
      <div class="cinema-featured-art"><img class="cinema-featured-image" alt="" loading="eager" decoding="async" fetchpriority="high"></div>
      <div class="cinema-featured-copy">
        <span class="cinema-featured-eyebrow">FEATURED FROM YOUR ARCHIVE</span>
        <div class="cinema-featured-verdict-row">
          <span class="cinema-featured-verdict"></span>
          <span class="cinema-featured-verdict-note"></span>
        </div>
        <h2 id="cinema-featured-title"></h2>
        <div class="cinema-featured-meta"></div>
        <p class="cinema-featured-synopsis"></p>
        <p class="cinema-featured-rating"></p>
        <div class="cinema-featured-actions">
          <button type="button" class="cinema-featured-button cinema-featured-details" data-featured-action="details">View details <span aria-hidden="true">↗</span></button>
          <button type="button" class="cinema-featured-button cinema-featured-watchlist" data-featured-action="watchlist" aria-pressed="false"></button>
          <button type="button" class="cinema-featured-button cinema-featured-trailer" data-featured-action="trailer">Watch trailer</button>
        </div>
        <p class="cinema-featured-status" role="status" aria-live="polite"></p>
      </div>`;
    movieArchive.insertBefore(featuredHero, movieArchive.firstChild);
    featuredStatus = featuredHero.querySelector(".cinema-featured-status");

    try {
      const savedWatchlist = window.localStorage.getItem("watchorskip-watchlist");
      if (savedWatchlist) {
        const parsedWatchlist = JSON.parse(savedWatchlist);
        if (!Array.isArray(parsedWatchlist) || parsedWatchlist.some((id) => typeof id !== "string")) {
          throw new TypeError("Saved watchlist data is not a list of movie IDs.");
        }
        watchlist = new Set(parsedWatchlist);
      }
    } catch (error) {
      console.error("Watch Or Skip could not read the saved watchlist.", error);
      featuredStatus.textContent = "Your saved watchlist could not be read in this browser.";
    }

    renderFeaturedMovie = () => {
      if (!films || !featuredHero) return;
      const detailsCard = [...movieArchive.querySelectorAll(".glass-panel")]
        .find((panel) => panel.querySelector("h1"));
      const title = detailsCard?.querySelector("h1")?.textContent.trim();
      const film = films.find((entry) => normalize(entry.title) === normalize(title ?? ""));
      const poster = detailsCard?.querySelector("img");
      const posterUrl = poster?.currentSrc || poster?.src;
      if (!film || !posterUrl) return;
      if (featuredHero.dataset.filmId === film.id && featuredHero.querySelector(".cinema-featured-image")?.src === posterUrl) return;

      const rating = film.rating?.match(/(\d+(?:\.\d+)?)\s*\/\s*10(?:\s*\(([^)]+)\))?/i);
      const score = rating ? Number(rating[1]) : null;
      const verdict = score === null ? "MAYBE" : score >= 8 ? "WATCH" : score >= 7 ? "MAYBE" : "SKIP";
      const ratingSource = rating?.[2] ?? "Archive";
      const genres = film.genres.slice(0, 3).join(" · ");
      const metadata = [String(film.year), genres, film.runtime].filter(Boolean).join("  ·  ");
      const posterAddress = new URL(posterUrl, window.location.href);
      if (posterAddress.protocol !== "https:" && posterAddress.origin !== window.location.origin) {
        console.error(`Watch Or Skip skipped an unsupported poster URL for ${film.title}.`);
        return;
      }

      featuredHero.dataset.filmId = film.id;
      featuredHero.innerHTML = `
        <div class="cinema-featured-art"><img class="cinema-featured-image" src="${escapeHtml(posterAddress.href)}" alt="${escapeHtml(`${film.title} movie poster`)}" loading="eager" decoding="async" fetchpriority="high"></div>
        <div class="cinema-featured-copy">
          <span class="cinema-featured-eyebrow">FEATURED FROM YOUR ARCHIVE</span>
          <div class="cinema-featured-verdict-row">
            <span class="cinema-featured-verdict cinema-featured-verdict-${verdict.toLowerCase()}">${verdict}</span>
            <span class="cinema-featured-verdict-note">ARCHIVE VERDICT · RATING-BASED</span>
          </div>
          <h2 id="cinema-featured-title">${escapeHtml(film.title)}</h2>
          <p class="cinema-featured-meta">${escapeHtml(metadata)}</p>
          <p class="cinema-featured-synopsis">${escapeHtml(film.synopsis)}</p>
          <p class="cinema-featured-rating">${rating ? `${escapeHtml(ratingSource)} <strong>${escapeHtml(rating[1])}/10</strong>` : "No archive rating available"}</p>
          <div class="cinema-featured-actions">
            <button type="button" class="cinema-featured-button cinema-featured-details" data-featured-action="details">View details <span aria-hidden="true">↗</span></button>
            <button type="button" class="cinema-featured-button cinema-featured-watchlist" data-featured-action="watchlist" aria-pressed="false"></button>
            <button type="button" class="cinema-featured-button cinema-featured-trailer" data-featured-action="trailer">Watch trailer</button>
          </div>
          <p class="cinema-featured-status" role="status" aria-live="polite"></p>
        </div>`;
      featuredStatus = featuredHero.querySelector(".cinema-featured-status");
      featuredHero.hidden = false;
      const watchlistButton = featuredHero.querySelector(".cinema-featured-watchlist");
      const isSaved = watchlist.has(film.id);
      watchlistButton.setAttribute("aria-pressed", String(isSaved));
      watchlistButton.innerHTML = `${isSaved ? "In watchlist" : "Add to watchlist"} <span aria-hidden="true">${isSaved ? "✓" : "+"}</span>`;
      featuredHero.querySelector(".cinema-featured-image").addEventListener("error", () => {
        featuredHero.classList.add("cinema-featured-art-unavailable");
        console.error(`Watch Or Skip could not load poster artwork for ${film.title}.`);
      }, { once: true });
    };

    let featuredUpdateFrame = 0;
    const featuredObserver = new MutationObserver((records) => {
      if (!records.some((record) => !featuredHero.contains(record.target))) return;
      if (featuredUpdateFrame) return;
      featuredUpdateFrame = window.requestAnimationFrame(() => {
        featuredUpdateFrame = 0;
        renderFeaturedMovie();
      });
    });
    featuredObserver.observe(movieArchive, { childList: true, characterData: true, subtree: true });

    featuredHero.addEventListener("click", (event) => {
      const action = event.target.closest("[data-featured-action]")?.dataset.featuredAction;
      if (!action || !featuredHero.dataset.filmId) return;
      const detailsCard = [...movieArchive.querySelectorAll(".glass-panel")]
        .find((panel) => panel.querySelector("h1"));
      const inspectButton = [...(detailsCard?.querySelectorAll("button") ?? [])]
        .find((button) => normalize(button.textContent).includes("inspect film reel"));
      const selectedFilm = films?.find((film) => film.id === featuredHero.dataset.filmId);

      if (action === "details" || action === "trailer") {
        if (!inspectButton) {
          featuredStatus.textContent = "Film details are not available right now.";
          return;
        }
        inspectButton.click();
        if (action === "details") return;

        let attempts = 0;
        const openTrailerTab = () => {
          const trailerTab = [...document.querySelectorAll("button")]
            .find((button) => normalize(button.textContent) === "watch trailer");
          if (trailerTab) {
            trailerTab.click();
            featuredHero.querySelector(".cinema-featured-status").textContent =
              "Trailer opened in the film viewer. Select Play Trailer to start playback.";
            return;
          }
          if (attempts++ < 20) {
            window.setTimeout(openTrailerTab, 50);
            return;
          }
          featuredHero.querySelector(".cinema-featured-status").textContent =
            "The trailer viewer could not be opened. Try View details instead.";
        };
        window.setTimeout(openTrailerTab, 50);
        return;
      }

      if (action === "watchlist" && selectedFilm) {
        const nextWatchlist = new Set(watchlist);
        if (nextWatchlist.has(selectedFilm.id)) nextWatchlist.delete(selectedFilm.id);
        else nextWatchlist.add(selectedFilm.id);
        try {
          window.localStorage.setItem("watchorskip-watchlist", JSON.stringify([...nextWatchlist]));
          watchlist = nextWatchlist;
          const button = featuredHero.querySelector(".cinema-featured-watchlist");
          const isSaved = watchlist.has(selectedFilm.id);
          button.setAttribute("aria-pressed", String(isSaved));
          button.innerHTML = `${isSaved ? "In watchlist" : "Add to watchlist"} <span aria-hidden="true">${isSaved ? "✓" : "+"}</span>`;
          featuredHero.querySelector(".cinema-featured-status").textContent =
            isSaved ? `${selectedFilm.title} added to your watchlist on this device.` : `${selectedFilm.title} removed from your watchlist.`;
        } catch (error) {
          console.error("Watch Or Skip could not save the watchlist.", error);
          featuredHero.querySelector(".cinema-featured-status").textContent =
            "Your watchlist could not be saved in this browser.";
        }
      }
    });
  }

  const navigate = (action) => {
    switch (action) {
      case "archive":
        root.querySelector("main")?.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      case "smart":
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => input.focus({ preventScroll: true }), 250);
        break;
      case "genres":
        genreDock?.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      case "search":
        [...root.querySelectorAll("header button")]
          .find((searchButton) => searchButton.textContent.toLowerCase().includes("search"))
          ?.click();
        break;
      default:
        return;
    }
    if (action !== "search") {
      topNav.querySelectorAll("[data-cinema-action]").forEach((item) => {
        if (item.tagName === "A") {
          if (item.dataset.cinemaAction === action) item.setAttribute("aria-current", "location");
          else item.removeAttribute("aria-current");
        }
      });
      rail.querySelectorAll(".cinema-rail-button").forEach((item) => {
        const isCurrent = item.dataset.cinemaAction === action || action === "genres" && item.dataset.cinemaAction === "archive";
        item.classList.toggle("is-active", isCurrent);
        if (isCurrent) item.setAttribute("aria-current", "location");
        else item.removeAttribute("aria-current");
      });
    }
  };

  topNav.addEventListener("click", (event) => {
    const control = event.target.closest("[data-cinema-action]");
    if (!control) return;
    event.preventDefault();
    navigate(control.dataset.cinemaAction);
  });

  rail.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cinema-action]");
    if (!button) return;
    navigate(button.dataset.cinemaAction);
  });

  fetch(new URL("./watchorskip-movies.json", import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the movie archive (${response.status}).`);
      return response.json();
    })
    .then((catalog) => {
      if (!Array.isArray(catalog) || catalog.length === 0) throw new Error("The movie archive is empty.");
      films = catalog;
      renderFeaturedMovie();
    })
    .catch((error) => {
      console.error("Smart Watch Or Skip could not load its movie archive.", error);
      output.innerHTML = `<p class="smart-error" role="alert">The movie archive could not be loaded. Please refresh and try again.</p>`;
    });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) {
      input.focus();
      return;
    }
    if (!films) {
      output.innerHTML = `<p class="smart-error" role="alert">The movie archive is still loading. Please try again in a moment.</p>`;
      return;
    }
    const { plan, ranked } = getMatches(query, films);
    renderRecommendations(output, query, ranked, plan);
    section.classList.add("has-result");
  });

  input.addEventListener("input", () => {
    section.classList.remove("has-result");
    output.replaceChildren();
  });

  section.querySelectorAll(".smart-example").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.textContent;
      form.requestSubmit();
    });
  });

  return true;
}

const appRoot = document.getElementById("root");
if (appRoot) {
  const observer = new MutationObserver(() => {
    if (mountWidget(appRoot)) observer.disconnect();
  });
  observer.observe(appRoot, { childList: true, subtree: true });
  mountWidget(appRoot);
}
