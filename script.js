// =============================================================================
// script.js — PokéStation Master Script
// =============================================================================


// =============================================================================
// MODULE 1: THEME ENGINE (runs on every page)
// Syncs dark/light mode toggle with localStorage on DOMContentLoaded.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.querySelector('.theme-switch input');

  function applyTheme() {
    const isLight = localStorage.getItem("theme") === "light";
    document.body.classList.toggle("light-mode", isLight);
    if (themeToggle) themeToggle.checked = isLight;
  }

  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      if (themeToggle.checked) {
        document.body.classList.add("light-mode");
        localStorage.setItem("theme", "light");
      } else {
        document.body.classList.remove("light-mode");
        localStorage.setItem("theme", "dark");
      }
    });
  }

  applyTheme();
});


// =============================================================================
// MODULE 2: HOME PAGE
// Initialises AOS animations and the preloader on index.html.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.body.classList.contains("page-home")) return;

  // Preloader
  window.addEventListener("load", () => {
    const loader = document.getElementById("preloader");
    if (loader) setTimeout(() => loader.classList.add("loader-hidden"), 1500);
  });

  // AOS
  if (typeof AOS !== "undefined") {
    AOS.init({ duration: 1000, once: true, offset: 120 });
  }
});


// =============================================================================
// MODULE 3: CARDS PAGE (cards.html)
// Handles card search, filtering, sorting, favourites, comparison, hover preview,
// offline fallback, and back-to-top button.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("grid")) return;   // guard — cards page only

  // ── Constants ──────────────────────────────────────────────────────────────
  const API      = "https://api.pokemontcg.io/v2/cards";
  const FAV_KEY  = "poke_fav";
  const PAGE_SIZE = 24;

  const PRELOADED_CARDS = [
    { id:"sv3-125",    name:"Charizard ex",         supertype:"Pokémon",  subtypes:["Stage 2","ex"],    hp:"330", types:["Fire"],    rarity:"Double Rare",      artist:"5ban Graphics", set:{name:"Obsidian Flames"},  images:{small:"images/charizex.png",     large:"images/bigcharizex.png"},    attacks:[{name:"Burning Darkness",  cost:["Fire","Fire"],                    damage:"180+", text:"Does 30 more damage for each Prize card your opponent has taken."}], weaknesses:[{type:"Water",    value:"x2"}], retreatCost:["Colorless","Colorless"] },
    { id:"sv1-189",    name:"Professor's Research", supertype:"Trainer",  subtypes:["Supporter"],       rarity:"Rare",              artist:"KirisAki",          set:{name:"Scarlet & Violet"},          images:{small:"images/prof",             large:"images/bigprof"},                attacks:[] },
    { id:"swsh9-151",  name:"Double Turbo Energy",  supertype:"Energy",   subtypes:["Special"],         rarity:"Uncommon",          artist:"N/A",               set:{name:"Brilliant Stars"},           images:{small:"images/doubleturbo",      large:"images/bigdoubleturbo"},         attacks:[] },
    { id:"sv4pt5-216", name:"Mew ex",               supertype:"Pokémon",  subtypes:["Basic","ex"],      hp:"180", types:["Psychic"], rarity:"Shiny Ultra Rare", artist:"5ban Graphics", set:{name:"Paldean Fates"},    images:{small:"images/mewex",            large:"images/bigmewex"},               attacks:[{name:"Genome Hack",        cost:["Colorless","Colorless","Colorless"], damage:"", text:"Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."}], weaknesses:[{type:"Darkness", value:"x2"}], resistances:[{type:"Fighting", value:"-30"}], retreatCost:[] }
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  let fav          = JSON.parse(localStorage.getItem(FAV_KEY)) || [];
  let compareQueue = [];
  let loadedCards  = {};
  let currentPage  = 1;

  // Seed offline lookup
  PRELOADED_CARDS.forEach(c => loadedCards[c.id] = c);

  // ── Favourites ─────────────────────────────────────────────────────────────
  function saveFav() {
    localStorage.setItem(FAV_KEY, JSON.stringify(fav));
    renderFav();
    syncButtons();
    if (fav.length === 0) resetClearUI();
  }

  function syncButtons() {
    $(".fav-btn").each(function() {
      const exists = fav.find(f => f.id === $(this).attr("data-id"));
      $(this)
        .toggleClass("btn-neon", !exists)
        .toggleClass("btn-danger", !!exists)
        .text(exists ? "★ Favourited" : "☆ Add to Fav");
    });
  }

  function renderFav() {
    const list = $("#favList");
    list.empty();
    if (!fav.length) {
      list.html("<li class='text-muted border-0'>No favourites saved yet.</li>");
      $("#clearInitial").hide();
      return;
    }
    $("#clearInitial").show();
    fav.forEach(c => list.append(
      `<li><span>${c.name}</span><button class="btn btn-sm btn-danger remove" data-id="${c.id}"><i class="fas fa-times"></i></button></li>`
    ));
  }

  $(document).on("click", ".remove", function() {
    fav = fav.filter(c => c.id !== $(this).data("id"));
    saveFav();
  });

  $("#btnPrepareClear").on("click", () => { $("#clearInitial").hide(); $("#clearConfirm").fadeIn(); });
  $("#btnConfirmClear").on("click", () => { fav = []; saveFav(); resetClearUI(); });
  $("#btnCancelClear").on("click",  () => resetClearUI());

  function resetClearUI() {
    $("#clearConfirm").hide();
    if (fav.length > 0) $("#clearInitial").show();
  }

  // ── Hover preview ──────────────────────────────────────────────────────────
  $(document).on("mousemove", ".card-img-trigger", function(e) {
    $("#hoverImg").attr("src", $(this).attr("src"));
    $("#hoverStats").html(`${$(this).data("name")}<br>HP: ${$(this).data("hp") || "N/A"}`);
    $("#hoverPreview").css({ top: e.clientY + 15 + "px", left: e.clientX + 15 + "px" }).show();
  });
  $(document).on("mouseleave", ".card-img-trigger", () => $("#hoverPreview").hide());

  // ── Search & filter ────────────────────────────────────────────────────────
  let searchTimer;
  $("#search, #typeFilter, #sortOrder, #supertypeFilter").on("change keyup", function(e) {
    if (e.type === "keyup" && e.key === "Enter") { clearTimeout(searchTimer); executeSearch(); return; }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => executeSearch(), 500);
  });

  function executeSearch() {
    currentPage = 1;
    fetchData($("#search").val(), $("#typeFilter").val(), $("#supertypeFilter").val(), false);
  }

  $("#loadMore").on("click", () => {
    currentPage++;
    fetchData($("#search").val(), $("#typeFilter").val(), $("#supertypeFilter").val(), true);
  });

  // ── Fetch ──────────────────────────────────────────────────────────────────
  function fetchData(q, type = "", supertype = "Pokémon", append = false) {
    if (!append) $("#grid").empty();
    $("#loading").show();
    $("#loadMore").hide();

    // Offline mode
    if (!navigator.onLine) {
      setTimeout(() => {
        $("#loading").hide();
        const cache      = JSON.parse(localStorage.getItem("card_cache")) || [];
        const sourceData = cache.length ? cache : PRELOADED_CARDS;
        const filtered   = sourceData.filter(c => {
          const matchType  = type === "" || (c.types && c.types.includes(type));
          const matchSuper = c.supertype === supertype;
          const matchName  = c.name.toLowerCase().includes(q.toLowerCase());
          return matchType && matchSuper && matchName;
        });
        filtered.forEach(c => loadedCards[c.id] = c);
        renderCards(filtered, append);
      }, 400);
      return;
    }

    // Online mode
    const queryParams = [];
    if (q.trim() !== "") queryParams.push(`name:"*${q}*"`);
    if (type !== "")      queryParams.push(`types:${type}`);
    queryParams.push(`supertype:${supertype}`);

    $.get(`${API}?q=${queryParams.join(" ")}&pageSize=${PAGE_SIZE}&page=${currentPage}`, res => {
      $("#loading").hide();
      const cards = res.data;
      localStorage.setItem("card_cache", JSON.stringify(cards));
      cards.forEach(c => loadedCards[c.id] = c);
      if (cards.length === PAGE_SIZE) $("#loadMore").show();

      const sort = $("#sortOrder").val();
      cards.sort((a, b) => {
        const hpA = parseInt(a.hp) || 0, hpB = parseInt(b.hp) || 0;
        if (sort === "az")      return a.name.localeCompare(b.name);
        if (sort === "za")      return b.name.localeCompare(a.name);
        if (sort === "hp_desc") return hpB - hpA;
        if (sort === "hp_asc")  return hpA - hpB;
        const nameA = a.name.toLowerCase(), nameB = b.name.toLowerCase(), query = q.toLowerCase();
        if (nameA === query && nameB !== query) return -1;
        if (nameB === query && nameA !== query) return  1;
        if (nameA.startsWith(query) && !nameB.startsWith(query)) return -1;
        if (nameB.startsWith(query) && !nameA.startsWith(query)) return  1;
        return hpB - hpA;
      });

      renderCards(cards, append);
    }).fail(() => {
      $("#loading").hide();
      renderCards(PRELOADED_CARDS, append);
    });
  }

  // ── Render grid ────────────────────────────────────────────────────────────
  function renderCards(cards, append = false) {
    const grid = $("#grid");
    if (!cards.length && !append) {
      grid.html("<div class='col-12 text-center my-5'><h4 class='text-muted'>No cards found.</h4></div>");
      return;
    }
    cards.forEach(c => {
      const isFav      = fav.find(f => f.id === c.id);
      const isCompared = compareQueue.find(q => q.id === c.id);
      const card = $(`
        <div class="col-sm-6 col-md-4 col-xl-3 mb-4">
          <div class="card-custom text-center" style="padding:15px;position:relative;display:flex;flex-direction:column;">
            <div class="position-absolute top-0 start-0 p-2" style="z-index:10;">
              <input type="checkbox" class="compare-chk" data-id="${c.id}" data-name="${c.name}" ${isCompared ? "checked" : ""}>
            </div>
            <img src="${c.images.small}" data-id="${c.id}" data-name="${c.name}" data-hp="${c.hp || "N/A"}" class="img-fluid mb-3 card-img-trigger" style="border-radius:8px;cursor:crosshair;">
            <h6 class="fw-bold mb-1 text-truncate">${c.name}</h6>
            <div class="text-muted small mb-3 text-truncate" style="font-size:0.8rem;">${c.set ? c.set.name : "Unknown Set"}</div>
            <div class="mt-auto d-flex flex-column gap-2">
              <button class="btn btn-info btn-sm view w-100">View Details</button>
              <button class="btn btn-sm w-100 ${isFav ? "btn-danger" : "btn-neon"} fav fav-btn" data-id="${c.id}" data-name="${c.name}">${isFav ? "★ Favourited" : "☆ Add to Fav"}</button>
            </div>
          </div>
        </div>`);

      card.find(".view").on("click", () => {
        localStorage.setItem("selected_card", JSON.stringify(c));
        window.location.href = `details.html?id=${c.id}`;
      });
      card.find(".fav").on("click", function() {
        if (fav.find(f => f.id === c.id)) fav = fav.filter(f => f.id !== c.id);
        else fav.push({ id: c.id, name: c.name });
        saveFav();
      });
      grid.append(card);
    });
  }

  // ── Comparison ─────────────────────────────────────────────────────────────
  $(document).on("change", ".compare-chk", function() {
    const id       = $(this).data("id");
    const fullCard = loadedCards[id];
    if (this.checked) {
      if (compareQueue.length >= 3) { alert("Max 3 cards!"); this.checked = false; return; }
      compareQueue.push(fullCard);
    } else {
      compareQueue = compareQueue.filter(item => item.id !== id);
    }
    updateCompareUI();
  });

  function updateCompareUI() {
    const list = $("#compareList").empty();
    if (!compareQueue.length) list.html("<li class='text-muted small'>None selected.</li>");
    compareQueue.forEach(q => list.append(`<li><i class="fas fa-check text-warning me-2"></i>${q.name}</li>`));
    $("#btnCompareNow").toggleClass("d-none", compareQueue.length < 2);
  }

  $("#btnCompareNow").on("click", () => {
    $("#compareBody").empty();
    $("#compareModal").modal("show");
    let html = "";
    compareQueue.forEach(c => {
      const attacks = c.attacks && c.attacks.length
        ? c.attacks.map(a => `<div class="mb-1"><strong>${a.name}</strong> <span class="text-warning">${a.damage ? "(" + a.damage + ")" : ""}</span></div>`).join("")
        : "No attacks listed.";
      const retreat = c.retreatCost
        ? '<i class="fas fa-circle text-muted small"></i> '.repeat(c.retreatCost.length)
        : "None";
      html += `
        <div class="col-md-4 text-center border-end border-secondary">
          <img src="${c.images.small}" class="img-fluid rounded mb-3 shadow">
          <h5 class="text-info mb-1">${c.name}</h5>
          <div class="badge bg-primary mb-3">${c.supertype} — ${c.types ? c.types[0] : "N/A"}</div>
          <div class="text-start small px-2">
            <div class="p-2 mb-2 bg-dark rounded border border-secondary">
              <p class="mb-1"><strong>❤️ HP:</strong> ${c.hp || "N/A"}</p>
              <p class="mb-1"><strong>🏃 Retreat:</strong> ${retreat}</p>
              <p class="mb-0"><strong>💎 Rarity:</strong> ${c.rarity || "Common"}</p>
            </div>
            <div class="p-2 bg-dark rounded border border-secondary">
              <p class="mb-2 text-info border-bottom border-secondary pb-1"><strong>⚔️ Attacks:</strong></p>
              ${attacks}
            </div>
          </div>
        </div>`;
    });
    $("#compareBody").html(html);
  });

  // ── Back-to-top ────────────────────────────────────────────────────────────
  $(window).on("scroll", function() {
    $(this).scrollTop() > 300 ? $("#backToTop").fadeIn() : $("#backToTop").fadeOut();
  });
  $("#backToTop").on("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  // ── Init ───────────────────────────────────────────────────────────────────
  renderFav();
  $("#search").focus();
  const urlParams  = new URLSearchParams(window.location.search);
  const searchName = urlParams.get("name");
  if (searchName) { $("#search").val(searchName); fetchData(searchName); }
  else            { fetchData(""); }
});


// =============================================================================
// MODULE 4: DETAILS PAGE (details.html)
// Loads full card details from localStorage cache, preloaded cards, or the API.
// Shows an offline banner when network is unavailable.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("cardDetails")) return;   // guard

  const DETAILS_CACHE_KEY = "card_details_cache";
  const PRELOADED_CARDS_DETAILS = [
    { id:"sv3-125",    name:"Charizard ex",         supertype:"Pokémon", subtypes:["Stage 2","ex"],    hp:"330", types:["Fire"],    rarity:"Double Rare",      artist:"5ban Graphics", set:{name:"Obsidian Flames"},  images:{small:"images/charizex.png",large:"images/bigcharizex.png"},  attacks:[{name:"Burning Darkness",  cost:["Fire","Fire"],                      damage:"180+", text:"Does 30 more damage for each Prize card your opponent has taken."}], weaknesses:[{type:"Water",    value:"x2"}], retreatCost:["Colorless","Colorless"] },
    { id:"sv1-189",    name:"Professor's Research", supertype:"Trainer", subtypes:["Supporter"],       rarity:"Rare",              artist:"KirisAki",          set:{name:"Scarlet & Violet"},         images:{small:"images/prof",         large:"images/bigprof"},              attacks:[] },
    { id:"swsh9-151",  name:"Double Turbo Energy",  supertype:"Energy",  subtypes:["Special"],         rarity:"Uncommon",          artist:"N/A",               set:{name:"Brilliant Stars"},          images:{small:"images/doubleturbo",  large:"images/bigdoubleturbo"},       attacks:[] },
    { id:"sv4pt5-216", name:"Mew ex",               supertype:"Pokémon", subtypes:["Basic","ex"],      hp:"180", types:["Psychic"], rarity:"Shiny Ultra Rare", artist:"5ban Graphics", set:{name:"Paldean Fates"},   images:{small:"images/mewex",        large:"images/bigmewex"},             attacks:[{name:"Genome Hack", cost:["Colorless","Colorless","Colorless"], damage:"", text:"Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack."}], weaknesses:[{type:"Darkness", value:"x2"}], resistances:[{type:"Fighting", value:"-30"}], retreatCost:[] }
  ];

  // ── Cache helpers ──────────────────────────────────────────────────────────
  function getDetailsCache() {
    try { return JSON.parse(localStorage.getItem(DETAILS_CACHE_KEY)) || {}; } catch { return {}; }
  }
  function saveToDetailsCache(id, data) {
    try {
      const cache = getDetailsCache();
      cache[id] = data;
      localStorage.setItem(DETAILS_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { console.warn("Cache write failed:", e); }
  }

  // ── Offline banner ─────────────────────────────────────────────────────────
  function showOfflineBanner() {
    $("#offlineBanner").fadeIn(200);
    $("body").css("padding-top", "36px");
  }
  window.addEventListener("online",  () => { $("#offlineBanner").hide(); $("body").css("padding-top", ""); });
  window.addEventListener("offline", () => showOfflineBanner());

  // ── Energy icon helper ─────────────────────────────────────────────────────
  function getEnergyIcon(type) {
    const icons = {
      Fire: "fire text-danger", Water: "tint text-primary", Grass: "leaf text-success",
      Lightning: "bolt text-warning", Psychic: "eye", Fighting: "fist-raised",
      Darkness: "moon text-secondary", Metal: "cog text-light",
      Dragon: "dragon text-warning", Colorless: "circle text-muted"
    };
    return `<i class="fas fa-${icons[type] || "circle"} me-1" title="${type}"></i>`;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderDetails(card) {
    $("#cardImg").attr("src", card.images.large || card.images.small || "");
    $("#cardName").text(card.name);
    $("#cardSub").text(card.supertype + (card.subtypes ? " — " + card.subtypes.join(", ") : ""));
    $("#cardHp").text(card.hp || "N/A");
    $("#cardType").text(card.types ? card.types.join(" / ") : "N/A");
    $("#cardRarity").text(card.rarity || "Common");
    $("#cardSet").text(card.set ? card.set.name : "Unknown");
    $("#cardArtist").text(card.artist || "Unknown");
    $("#tcgLink").attr("href", card.tcgplayer ? card.tcgplayer.url : "#");

    if (card.weaknesses && card.weaknesses.length) {
      $("#cardWeak").html(card.weaknesses.map(w =>
        `<span class="badge bg-danger d-inline-flex align-items-center gap-1 me-1">${getEnergyIcon(w.type)} ${w.value}</span>`
      ).join(""));
    }
    if (card.resistances && card.resistances.length) {
      $("#cardResist").html(card.resistances.map(r =>
        `<span class="badge bg-success d-inline-flex align-items-center gap-1 me-1">${getEnergyIcon(r.type)} ${r.value}</span>`
      ).join(""));
    }
    if (card.retreatCost && card.retreatCost.length) {
      $("#cardRetreat").html(card.retreatCost.map(t => getEnergyIcon(t)).join(" "));
    }

    if (card.tcgplayer && card.tcgplayer.prices) {
      const priceType = Object.keys(card.tcgplayer.prices)[0];
      const priceData = card.tcgplayer.prices[priceType];
      $("#marketPrice").text("$" + (priceData.market || priceData.mid || "N/A"));
      $("#priceChange")
        .text(priceData.directLow ? "Available" : "Stable")
        .addClass(priceData.directLow ? "text-success" : "text-info");
      $("#priceSection").show();
    }

    let attackHtml = "";
    if (card.abilities) {
      card.abilities.forEach(a => {
        attackHtml += `
          <div class="mb-3">
            <span class="badge bg-danger me-2">Ability</span>
            <strong class="text-info">${a.name}</strong>
            <p class="small text-muted mb-0 mt-1">${a.text || ""}</p>
          </div>`;
      });
    }
    if (card.attacks) {
      card.attacks.forEach(a => {
        const costIcons = a.cost ? a.cost.map(t => getEnergyIcon(t)).join("") : "";
        attackHtml += `
          <div class="mb-3 border-bottom border-secondary pb-2">
            <div class="d-flex justify-content-between align-items-center">
              <div><span class="me-2">${costIcons}</span><strong class="text-info">${a.name}</strong></div>
              <span class="text-warning h5 mb-0">${a.damage || ""}</span>
            </div>
            <p class="small text-muted mb-0 mt-1">${a.text || ""}</p>
          </div>`;
      });
    }
    $("#cardAttacks").html(attackHtml || '<p class="text-muted">No specific attacks listed.</p>');
    $("#loading").hide();
    $("#cardDetails").fadeIn();
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  const urlParams   = new URLSearchParams(window.location.search);
  const cardId      = urlParams.get("id");

  if (!cardId) { window.location.href = "cards.html"; return; }

  const detailsCache = getDetailsCache();
  let selectedCard   = null;
  try { const raw = localStorage.getItem("selected_card"); if (raw) selectedCard = JSON.parse(raw); } catch {}

  const preloaded = PRELOADED_CARDS_DETAILS.find(c => c.id === cardId);

  if (selectedCard && selectedCard.id === cardId) {
    saveToDetailsCache(cardId, selectedCard);
    localStorage.removeItem("selected_card");
    renderDetails(selectedCard);

  } else if (preloaded) {
    if (!navigator.onLine) showOfflineBanner();
    renderDetails(preloaded);

  } else if (detailsCache[cardId]) {
    if (!navigator.onLine) showOfflineBanner();
    renderDetails(detailsCache[cardId]);
    if (navigator.onLine) {
      $.get(`https://api.pokemontcg.io/v2/cards/${cardId}`, res => saveToDetailsCache(cardId, res.data)).fail(() => {});
    }

  } else if (navigator.onLine) {
    $.get(`https://api.pokemontcg.io/v2/cards/${cardId}`, res => {
      saveToDetailsCache(cardId, res.data);
      renderDetails(res.data);
    }).fail(() => { $("#loading").hide(); $("#offlineError").fadeIn(); });

  } else {
    showOfflineBanner();
    $("#loading").hide();
    $("#offlineError").fadeIn();
  }
});


// =============================================================================
// MODULE 5: DECK BUILDER (deck.html)
// Handles card search, deck add/remove/clear, suggested cards panel, and
// the favourites injection sidebar.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("deckList")) return;   // guard

  const API_BASE_URL      = "https://api.pokemontcg.io/v2/cards";
  const DECK_SESSION_KEY  = "poketcg_deck_session";
  const DECK_BACKUP_KEY   = "poketcg_deck_backup";

  const SUGGESTED_CARDS = [
    { id:"sv3-125",   name:"Charizard ex",        supertype:"Pokémon", subtypes:["Stage 2","ex"],   images:{small:"https://images.pokemontcg.io/sv3/125.png"} },
    { id:"sv1-198",   name:"Professor's Research", supertype:"Trainer", subtypes:["Supporter"],      images:{small:"https://images.pokemontcg.io/sv1/198.png"} },
    { id:"sv1-181",   name:"Nest Ball",            supertype:"Trainer", subtypes:["Item"],           images:{small:"https://images.pokemontcg.io/sv1/181.png"} },
    { id:"sv1-196",   name:"Ultra Ball",           supertype:"Trainer", subtypes:["Item"],           images:{small:"https://images.pokemontcg.io/sv1/196.png"} },
    { id:"sv2-171",   name:"Boss's Orders",        supertype:"Trainer", subtypes:["Supporter"],      images:{small:"https://images.pokemontcg.io/sv2/171.png"} },
    { id:"swsh9-132", name:"Double Turbo Energy",  supertype:"Energy",  subtypes:["Special"],        images:{small:"https://images.pokemontcg.io/swsh9/132.png"} },
    { id:"sv1-190",   name:"Rare Candy",           supertype:"Trainer", subtypes:["Item"],           images:{small:"https://images.pokemontcg.io/sv1/190.png"} },
    { id:"sv4pt5-54", name:"Mew ex",               supertype:"Pokémon", subtypes:["Basic","ex"],     images:{small:"https://images.pokemontcg.io/sv4pt5/54.png"} }
  ];

  let currentDeck = [];

  // ── Persistence ────────────────────────────────────────────────────────────
  function loadDeck() {
    const stored = sessionStorage.getItem(DECK_SESSION_KEY) || localStorage.getItem(DECK_BACKUP_KEY);
    if (stored) currentDeck = JSON.parse(stored);
    renderDeck();
  }
  function saveDeck() {
    sessionStorage.setItem(DECK_SESSION_KEY, JSON.stringify(currentDeck));
    localStorage.setItem(DECK_BACKUP_KEY, JSON.stringify(currentDeck));
    renderDeck();
  }

  // ── Add / remove ───────────────────────────────────────────────────────────
  window.addCardToDeck = function(card) {
    const total    = currentDeck.reduce((s, i) => s + i.qty, 0);
    if (total >= 60) { showToast("⚠️ Deck limit 60 reached."); return; }
    const existing = currentDeck.find(i => i.id === card.id);
    if (existing) {
      if (existing.supertype !== "Energy" && existing.qty >= 4) { showToast(`⚠️ Max 4 copies for ${card.name}.`); return; }
      existing.qty++;
    } else {
      currentDeck.push({ id: card.id, name: card.name, supertype: card.supertype, img: card.images ? card.images.small : card.img, qty: 1 });
    }
    saveDeck();
    showToast(`✅ Added ${card.name}.`);
  };

  window.removeCardFromDeck = function(id) {
    const existing = currentDeck.find(i => i.id === id);
    if (existing) {
      existing.qty--;
      if (existing.qty <= 0) currentDeck = currentDeck.filter(i => i.id !== id);
      saveDeck();
    }
  };

  // ── Render deck panel ──────────────────────────────────────────────────────
  function renderDeck() {
    const $list   = $("#deckList");
    const textCls = document.body.classList.contains("light-mode") ? "text-dark" : "text-white";
    $list.empty();
    let total = 0;
    if (!currentDeck.length) {
      $list.html('<div class="text-center text-muted my-4">Deck is empty.</div>');
    } else {
      currentDeck.forEach(item => {
        total += item.qty;
        $list.append(`
          <div class="p-2 mb-2 d-flex align-items-center border border-secondary rounded">
            <img src="${item.img}" style="width:40px;margin-right:10px;border-radius:4px;">
            <div class="flex-grow-1">
              <div class="fw-bold ${textCls} small">${item.name}</div>
              <div class="text-warning small fw-bold">Qty: ${item.qty}</div>
            </div>
            <button class="btn btn-link text-danger p-1" onclick="removeCardFromDeck('${item.id}')"><i class="fas fa-minus-circle fa-lg"></i></button>
          </div>`);
      });
    }
    $("#deckCountBadge")
      .text(`${total}/60`)
      .toggleClass("bg-success", total === 60)
      .toggleClass("bg-secondary", total !== 60);
  }

  // ── Render card grid ───────────────────────────────────────────────────────
  function renderCardGrid(cards, title, isSearch = false) {
    const textCls = document.body.classList.contains("light-mode") ? "text-dark" : "text-white";
    $("#resultsHeader").html(title);
    $("#resultsGrid").empty();
    isSearch ? $("#btnBackToSuggestions").removeClass("d-none") : $("#btnBackToSuggestions").addClass("d-none");
    cards.forEach(card => {
      const $card = $(`
        <div class="col-sm-6 col-xl-4 mb-3">
          <div class="tcg-card-wrap p-2 text-center h-100 d-flex flex-column">
            <img src="${card.images.small}" class="img-fluid mb-2 rounded shadow-sm">
            <div class="fw-bold mb-1 small ${textCls}">${card.name}</div>
            <div class="text-muted small mb-2" style="font-size:0.75rem;">${card.supertype}</div>
            <button class="btn-add-deck w-100 py-2 mt-auto">Add to Deck</button>
          </div>
        </div>`);
      $card.find(".btn-add-deck").on("click", () => window.addCardToDeck(card));
      $("#resultsGrid").append($card);
    });
  }

  function loadSuggestions() { renderCardGrid(SUGGESTED_CARDS, "🌟 Suggested Cards", false); }
  $("#btnBackToSuggestions").on("click", loadSuggestions);

  // ── Search form ────────────────────────────────────────────────────────────
  $("#searchForm").on("submit", function(e) {
    e.preventDefault();
    const query     = $("#searchQuery").val().trim();
    const supertype = $("#supertypeFilter").val();
    let qParam      = `name:"*${query}*"`;
    if (supertype) qParam += ` supertype:"${supertype}"`;
    $("#loading").show();
    $("#resultsGrid").empty();
    $.ajax({ url: `${API_BASE_URL}?q=${encodeURIComponent(qParam)}&pageSize=12` })
      .done(res  => { $("#loading").hide(); renderCardGrid(res.data, `🔍 Results (${res.data.length})`, true); })
      .fail(()   => { $("#loading").hide(); showToast("❌ Error fetching data."); });
  });

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(msg) {
    $("#toastMsg").text(msg);
    new bootstrap.Toast(document.getElementById("deckToast")).show();
  }

  $("#btnClearDeck").on("click", () => {
    if (confirm("Clear entire deck?")) { currentDeck = []; saveDeck(); }
  });

  // ── Favourites injection sidebar ───────────────────────────────────────────
  (function() {
    const FAV_KEY   = "poke_fav";
    const CACHE_KEY = "poketcg_fav_cache";

    const favSection = document.createElement("div");
    favSection.className = "fav-from-cards-panel p-4 mt-4";
    favSection.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom border-secondary">
        <h5 class="m-0" style="font-weight:800;font-size:1.2rem;letter-spacing:1px;color:#818cf8;"><i class="fas fa-star me-2"></i>My Favourites</h5>
        <span class="fav-badge-count" id="favBadgeCount">0</span>
      </div>
      <div id="favFromCardsList" style="max-height:420px;overflow-y:auto;padding-right:4px;">
        <div class="fav-empty-msg">Loading favourites… <span class="fav-loading-spinner ms-2"></span></div>
      </div>
      <div class="mt-3 pt-2 border-top border-secondary" style="font-size:0.75rem;color:#64748b;text-align:center;">
        Manage favourites in the <a href="cards.html" style="color:#818cf8;">Cards</a> page
      </div>`;
    const injectionPoint = document.getElementById("favInjectionPoint");
    if (injectionPoint) injectionPoint.appendChild(favSection);

    function getSupertypeBadge(s) {
      const map = { "Pokémon": "pokemon", "Trainer": "trainer", "Energy": "energy" };
      return `<span class="fav-supertype-badge fav-type-${map[s] || "other"}">${s || "?"}</span>`;
    }
    function getFavs()  { try { return JSON.parse(localStorage.getItem(FAV_KEY))  || []; } catch { return []; } }
    function getCache() { try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } }
    function setCache(c){ try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }

    async function fetchCardDetails(id) {
      const cache = getCache();
      if (cache[id]) return cache[id];
      try {
        const res  = await fetch(`${API_BASE_URL}/${id}`);
        const data = await res.json();
        const c    = data.data;
        const slim = { id: c.id, name: c.name, supertype: c.supertype, img: c.images?.small || "" };
        cache[id] = slim; setCache(cache); return slim;
      } catch { return null; }
    }

    async function renderFavFromCards() {
      const favs    = getFavs();
      const listEl  = document.getElementById("favFromCardsList");
      const badgeEl = document.getElementById("favBadgeCount");
      if (!listEl || !badgeEl) return;
      badgeEl.textContent = favs.length;
      if (!favs.length) {
        listEl.innerHTML = `<div class="fav-empty-msg">No favourites yet.<br>Go to <a href="cards.html" style="color:#818cf8;">Cards</a> to add some!</div>`;
        return;
      }
      listEl.innerHTML = favs.map(() => `<div class="fav-entry"><div style="width:42px;height:58px;background:rgba(255,255,255,0.05);border-radius:5px;flex-shrink:0;"></div><div style="flex:1"><div style="height:10px;background:rgba(255,255,255,0.08);border-radius:4px;margin-bottom:6px;width:70%;"></div><div style="height:8px;background:rgba(255,255,255,0.05);border-radius:4px;width:40%;"></div></div></div>`).join("");
      const details = (await Promise.all(favs.map(f => fetchCardDetails(f.id)))).filter(Boolean);
      if (!details.length) { listEl.innerHTML = `<div class="fav-empty-msg">Could not load details.</div>`; return; }
      listEl.innerHTML = "";
      const textCls = document.body.classList.contains("light-mode") ? "text-dark" : "text-white";
      details.forEach(card => {
        const entry = document.createElement("div");
        entry.className = "fav-entry";
        entry.innerHTML = `
          ${card.img ? `<img src="${card.img}" class="fav-card-thumb">` : `<div style="width:42px;height:58px;background:rgba(255,255,255,0.05);border-radius:5px;flex-shrink:0;"></div>`}
          <div style="flex:1;min-width:0;">
            <div class="fw-bold ${textCls}" style="font-size:0.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${card.name}</div>
            <div class="mt-1">${getSupertypeBadge(card.supertype)}</div>
          </div>
          <button class="fav-add-btn" title="Add to deck">+ Deck</button>`;
        entry.querySelector(".fav-add-btn").addEventListener("click", () => window.addCardToDeck(card));
        listEl.appendChild(entry);
      });
    }

    renderFavFromCards();
    window.addEventListener("storage", e => { if (e.key === FAV_KEY) renderFavFromCards(); });
  })();

  // ── Init ───────────────────────────────────────────────────────────────────
  loadDeck();
  loadSuggestions();
});


// =============================================================================
// MODULE 6: SHOP PAGE (shop.html)
// Handles wishlist, cart, form validation, and card popup.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("wishlist")) return;   // guard

  const W_KEY = "wishlist";
  const C_KEY = "cart";
  let wishlist = JSON.parse(localStorage.getItem(W_KEY)) || [];
  let cart     = JSON.parse(localStorage.getItem(C_KEY)) || [];

  const packCards = {
    "Scarlet & Violet Pack": [
      { name:"Lechonk",      rarity:"Common",     img:"https://images.pokemontcg.io/sv1/155.png" },
      { name:"Sprigatito",   rarity:"Common",     img:"https://images.pokemontcg.io/sv1/13.png"  },
      { name:"Floragato",    rarity:"Uncommon",   img:"https://images.pokemontcg.io/sv1/14.png"  },
      { name:"Meowscarada",  rarity:"Rare",       img:"https://images.pokemontcg.io/sv1/15.png"  },
      { name:"Armarouge",    rarity:"Rare",       img:"https://images.pokemontcg.io/sv1/41.png"  },
      { name:"Gardevoir ex", rarity:"Ultra Rare", img:"https://images.pokemontcg.io/sv1/86.png"  },
      { name:"Miraidon ex",  rarity:"Ultra Rare", img:"https://images.pokemontcg.io/sv1/81.png"  }
    ],
    "Paldea Evolved Pack": [
      { name:"Tinkatink",   rarity:"Common",     img:"https://images.pokemontcg.io/sv2/103.png" },
      { name:"Tinkatuff",   rarity:"Uncommon",   img:"https://images.pokemontcg.io/sv2/104.png" },
      { name:"Tinkaton",    rarity:"Rare",       img:"https://images.pokemontcg.io/sv2/105.png" },
      { name:"Baxcalibur",  rarity:"Rare",       img:"https://images.pokemontcg.io/sv2/60.png"  },
      { name:"Chien-Pao ex",rarity:"Ultra Rare", img:"https://images.pokemontcg.io/sv2/61.png"  }
    ],
    "Obsidian Flames Pack": [
      { name:"Charmander",  rarity:"Common",     img:"https://images.pokemontcg.io/sv3/26.png"  },
      { name:"Charmeleon",  rarity:"Uncommon",   img:"https://images.pokemontcg.io/sv3/27.png"  },
      { name:"Absol",       rarity:"Rare",       img:"https://images.pokemontcg.io/sv3/113.png" },
      { name:"Darkrai",     rarity:"Rare",       img:"https://images.pokemontcg.io/sv3/136.png" },
      { name:"Charizard ex",rarity:"Ultra Rare", img:"https://images.pokemontcg.io/sv3/125.png" }
    ]
  };

  function save() {
    localStorage.setItem(W_KEY, JSON.stringify(wishlist));
    localStorage.setItem(C_KEY, JSON.stringify(cart));
    render();
  }

  function render() {
    const w = $("#wishlist"), c = $("#cart");
    w.empty(); c.empty();
    wishlist.forEach(i => w.append(`<li>${i}</li>`));
    cart.forEach((i, idx) => c.append(`<li>${i.name} x${i.qty} <button class="btn btn-sm btn-outline-danger ms-2" onclick="shopRemoveItem(${idx})">Remove</button></li>`));
  }

  window.addWishlist  = name => { if (!wishlist.includes(name)) { wishlist.push(name); save(); } else alert("Already in wishlist"); };
  window.addCart      = name => { const item = cart.find(i => i.name === name); if (item) item.qty++; else cart.push({ name, qty: 1 }); save(); };
  window.shopRemoveItem = idx  => { cart.splice(idx, 1); save(); };
  window.clearAll     = ()   => { if (confirm("Clear all data?")) { wishlist = []; cart = []; save(); } };

  window.validateForm = () => {
    const n = $("#name").val().trim(), e = $("#email").val().trim(), m = $("#msg").val().trim();
    if (!n || !e || !m) { alert("Fill all fields"); return false; }
    if (!e.includes("@")) { alert("Invalid email"); return false; }
    alert("Message sent!"); return false;
  };

  window.viewCards = packName => {
    $("#popupTitle").text(packName + " Cards");
    $("#popupCards").html(packCards[packName].map(card => `
      <div style="text-align:center;">
        <img src="${card.img}">
        <div style="font-size:13px;margin-top:4px;">${card.name}</div>
        <div style="font-size:11px;color:#6b21a8;">${card.rarity}</div>
      </div>`).join(""));
    $("#cardPopup").addClass("show").hide().fadeIn();
  };

  window.closeCards = () => $("#cardPopup").fadeOut(() => $("#cardPopup").removeClass("show"));
  $("#cardPopup").on("click", function(e) { if (e.target.id === "cardPopup") window.closeCards(); });

  render();
});


// =============================================================================
// MODULE 7: CONTACT PAGE (contact.html)
// Saves submitted contact form to localStorage and shows a toast confirmation.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const contactForm = document.getElementById("contactForm");
  if (!contactForm) return;   // guard

  $(contactForm).on("submit", function(e) {
    e.preventDefault();
    const data = JSON.parse(localStorage.getItem("contacts")) || [];
    data.push({
      name:    $("#name").val().trim(),
      email:   $("#email").val().trim(),
      message: $("#message").val().trim(),
      time:    new Date().toLocaleString()
    });
    localStorage.setItem("contacts", JSON.stringify(data));
    $("#toast").fadeIn().delay(2000).fadeOut();
    contactForm.reset();
  });
});


// =============================================================================
// MODULE 8: NEWS PAGE (news.html)
// Handles the filter buttons that show/hide news categories.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  if (!document.body.classList.contains("page-news")) return;   // guard

  $(".btn-outline-info").on("click", function() {
    $(".btn-outline-info").removeClass("active");
    $(this).addClass("active");

    const filterValue = $(this).text().toLowerCase().trim().replace(/\s+/g, "-");

    if (filterValue === "all") {
      $("#news-list").show().removeClass("col-lg-12").addClass("col-lg-8");
      $("#events-sidebar").show().removeClass("col-lg-12").addClass("col-lg-4");
      $(".news-item").fadeIn(300);
    } else if (filterValue === "events") {
      $(".news-item").hide();
      $("#news-list").hide();
      $("#events-sidebar").removeClass("col-lg-4").addClass("col-lg-12").fadeIn(300);
    } else {
      $(".news-item").hide();
      $("#events-sidebar").hide();
      $("#news-list").show().removeClass("col-lg-8").addClass("col-lg-12");
      const targetClass = filterValue === "tcg-sets" ? ".sets" : ".updates";
      $(targetClass).fadeIn(300);
    }
  });
});


// =============================================================================
// MODULE 9: HOW TO PLAY PAGE (how2play.html)
// Reading progress bar and TCG rules quiz.
// =============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const progressBar = document.getElementById("readingProgressBar");
  if (!progressBar) return;   // guard

  // Reading progress bar
  window.addEventListener("scroll", () => {
    const d = document.documentElement;
    progressBar.style.width = Math.min(d.scrollTop / (d.scrollHeight - d.clientHeight) * 100, 100) + "%";
  }, { passive: true });

  // Quiz
  (function() {
    const QS = [
      { q:"How many Prize Cards does each player set aside at the start?", opts:["4","5","6","7"],                                   ans:2, hint:"Each player places 6 Prize Cards face-down. Take all 6 to win!" },
      { q:"How many cards does each player draw as their opening hand?",   opts:["5","6","7","8"],                                   ans:2, hint:"Both players start with 7 cards in hand." },
      { q:"How many Energy cards may you attach per turn?",                opts:["As many as you like","2","1","Only on first turn"], ans:2, hint:"Exactly 1 Energy card may be attached per turn." },
      { q:"What is the total number of cards in a standard deck?",         opts:["40","50","60","72"],                               ans:2, hint:"A legal deck must contain exactly 60 cards." },
      { q:"What happens immediately after you use an attack?",             opts:["Draw 2 cards","Your turn ends","Play a Trainer card","Attach another Energy"], ans:1, hint:"Attacking always ends your turn immediately." }
    ];

    let cur = 0, score = 0;
    const qText    = document.getElementById("qText");
    const qOpts    = document.getElementById("qOpts");
    const qFb      = document.getElementById("qFeedback");
    const btnNext  = document.getElementById("btnNext");
    const qCounter = document.getElementById("qCounter");
    const qMain    = document.getElementById("qMain");
    const qResult  = document.getElementById("qResult");

    if (!qText) return;   // quiz elements not present

    function load() {
      const q = QS[cur];
      qCounter.textContent = `Question ${cur + 1} of ${QS.length}`;
      qText.textContent    = q.q;
      qFb.textContent      = "";
      qFb.className        = "quiz-feedback";
      btnNext.style.display = "none";
      qOpts.innerHTML      = "";
      q.opts.forEach((o, i) => {
        const b = document.createElement("button");
        b.className  = "quiz-opt";
        b.textContent = o;
        b.onclick    = () => pick(i, b);
        qOpts.appendChild(b);
      });
    }

    function pick(i, btn) {
      qOpts.querySelectorAll(".quiz-opt").forEach(b => b.disabled = true);
      const correct = QS[cur].ans;
      if (i === correct) {
        btn.classList.add("correct");
        score++;
        qFb.className   = "quiz-feedback ok";
        qFb.textContent = "✅ " + QS[cur].hint;
      } else {
        btn.classList.add("wrong");
        qOpts.querySelectorAll(".quiz-opt")[correct].classList.add("correct");
        qFb.className   = "quiz-feedback bad";
        qFb.textContent = "❌ " + QS[cur].hint;
      }
      btnNext.style.display = "inline-block";
      btnNext.textContent   = cur < QS.length - 1 ? "Next →" : "See Results →";
    }

    btnNext.onclick = () => {
      cur++;
      if (cur < QS.length) {
        load();
      } else {
        qMain.style.display   = "none";
        qResult.style.display = "block";
        qCounter.textContent  = "Quiz Complete!";
        document.getElementById("qScore").textContent = `${score} / ${QS.length}`;
        const msgs = ["Keep studying the guide! 📖", "Getting there, trainer! 💪", "Nice work! ⭐", "Great job! 🌟", "Pokémon Master! 🏆"];
        document.getElementById("qMsg").textContent = msgs[score] || msgs[0];
      }
    };

    document.getElementById("btnRestart").onclick = () => {
      cur = 0; score = 0;
      qResult.style.display = "none";
      qMain.style.display   = "block";
      load();
    };

    load();
  })();
});
