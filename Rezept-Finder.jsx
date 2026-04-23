import { useState, useRef, useEffect, useCallback } from "react";

// ==================== CONSTANTS ====================
const COLORS = {
  bg: "#FDF6F0",
  card: "#FFFFFF",
  accent: "#D4654A",
  accentDark: "#A8422E",
  accentLight: "#F0A58E",
  green: "#5A9E6F",
  greenLight: "#D4EDDA",
  orange: "#E8913A",
  orangeLight: "#FDE8D0",
  text: "#3B2F2F",
  textLight: "#7A6B6B",
  border: "#E8DDD5",
  legendBg: "#FAF5F2",
  timerBg: "#FFF3ED",
  tipBg: "#F0F7F1",
};

const API_MODEL = "claude-sonnet-4-20250514";

// ==================== API HELPER ====================
// Retry-Logik bei 429 (Rate Limit): wartet 25s und versucht erneut (max. 2x)
async function callClaude(apiKey, systemPrompt, userContent, useWebSearch = false, onRetry = null) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Kein API-Key hinterlegt. Bitte oben rechts auf das Zahnrad klicken und einen Claude API-Key eintragen.");
  }

  const body = {
    model: API_MODEL,
    max_tokens: 2500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  };
  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const maxRetries = 2;
  const waitSeconds = 25;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(
        "Verbindung zur Claude-API fehlgeschlagen. Mögliche Gründe: kein Internet, ungültiger API-Key, oder CORS-Blockierung. Originaler Fehler: " + e.message
      );
    }

    if (res.ok) {
      const data = await res.json();
      const textBlocks = data.content.filter((b) => b.type === "text").map((b) => b.text);
      return textBlocks.join("\n");
    }

    // Rate-Limit: warten und erneut versuchen
    if (res.status === 429 && attempt < maxRetries) {
      if (onRetry) onRetry(attempt + 1, waitSeconds);
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      continue;
    }

    const err = await res.text();
    if (res.status === 401) {
      throw new Error("API-Key ungültig oder abgelaufen. Bitte in den Einstellungen (Zahnrad oben rechts) einen gültigen Key eintragen.");
    }
    if (res.status === 429) {
      throw new Error(`Die API-Grenze ist erreicht. Bitte in 1–2 Minuten erneut versuchen.`);
    }
    throw new Error(`API-Fehler (${res.status}): ${err}`);
  }
}

function extractJSON(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (m) return JSON.parse(m[1].trim());
  const m2 = text.match(/\{[\s\S]*\}/);
  if (m2) return JSON.parse(m2[0]);
  const m3 = text.match(/\[[\s\S]*\]/);
  if (m3) return JSON.parse(m3[0]);
  throw new Error("Kein JSON gefunden");
}

// ==================== LOADING MESSAGES ====================
const LOADING_SEARCH = [
  "Durchstöbere Rezepte…",
  "Prüfe Eiweißkombinationen…",
  "Berechne Nährwerte…",
  "Fast geschafft…",
];
const LOADING_RECIPE = [
  "Lese das Rezept im Detail…",
  "Sortiere Zutaten und Schritte…",
  "Berechne Mengen und Timer…",
];
const LOADING_PDF = [
  "Erstelle druckfertiges Layout…",
  "Formatiere für A4…",
];

// ==================== COMPONENTS ====================

function LoadingScreen({ messages }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setIdx((i) => (i + 1) % messages.length), 2500);
    return () => clearInterval(iv);
  }, [messages]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, gap: 24 }}>
      <div style={{ width: 48, height: 48, border: `4px solid ${COLORS.border}`, borderTopColor: COLORS.accent, borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
      <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: COLORS.textLight, textAlign: "center", minHeight: 24, transition: "opacity 0.3s" }}>{messages[idx]}</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ==================== SEARCH SCREEN ====================
function SearchScreen({ onSearch }) {
  const [query, setQuery] = useState("");
  const [maxTime, setMaxTime] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [diet, setDiet] = useState(""); // Fisch, Fleisch, Vegetarisch, Vegan
  const [image, setImage] = useState(null);
  const fileRef = useRef();
  const dropRef = useRef();

  const handleFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Full = e.target.result;
      const base64Data = base64Full.split(",")[1];
      const mediaType = file.type === "image/heic" ? "image/jpeg" : file.type;
      setImage({ base64: base64Data, preview: base64Full, name: file.name, mediaType });
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.remove("drag-over");
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const canSubmit = query.trim() || image;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 24px" }}>
      {/* Logo / Title */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 42, marginBottom: 8 }}>🍳</div>
        <h1 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "2rem", color: COLORS.text, margin: 0, lineHeight: 1.2 }}>
          Rezept-Finder
        </h1>
        <p style={{ fontFamily: "'DM Sans',sans-serif", color: COLORS.textLight, fontSize: 14, marginTop: 8 }}>
          Finde das perfekte Rezept — proteinoptimiert und auf dich zugeschnitten
        </p>
      </div>

      {/* Search Field */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Was hast du da? Oder worauf hast du Lust?"
          rows={3}
          style={{
            width: "100%", fontFamily: "'DM Sans',sans-serif", fontSize: 15, padding: "16px 18px",
            border: `2px solid ${COLORS.border}`, borderRadius: 14, resize: "none", outline: "none",
            background: COLORS.card, color: COLORS.text, lineHeight: 1.5,
            boxSizing: "border-box",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => (e.target.style.borderColor = COLORS.accent)}
          onBlur={(e) => (e.target.style.borderColor = COLORS.border)}
        />
      </div>

      {/* Drop Zone */}
      <div
        ref={dropRef}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); dropRef.current?.classList.add("drag-over"); }}
        onDragLeave={() => dropRef.current?.classList.remove("drag-over")}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${image ? COLORS.green : COLORS.border}`,
          borderRadius: 14, padding: image ? 12 : 28, textAlign: "center", cursor: "pointer",
          background: image ? COLORS.greenLight + "33" : COLORS.legendBg,
          transition: "all 0.25s", marginBottom: 20,
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
        {image ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={image.preview} alt="Vorschau" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10 }} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, color: COLORS.text }}>{image.name}</div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: COLORS.green }}>✓ Foto bereit</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setImage(null); }} style={{
              width: 28, height: 28, borderRadius: "50%", border: "none", background: COLORS.accent, color: "#fff",
              fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}>✕</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: COLORS.textLight, lineHeight: 1.5 }}>
              Foto hierher ziehen oder klicken<br />
              <span style={{ fontSize: 12 }}>z. B. aus einem Rezeptbuch, Zeitschrift oder Verpackung</span>
            </div>
          </>
        )}
      </div>

      {/* Filter: Zeit + Küche + Ernährung */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {/* Zeitlimit */}
        <div style={{ flex: 1, minWidth: 100 }}>
          <label style={filterLabel}>⏱ Max. Dauer</label>
          <select value={maxTime} onChange={(e) => setMaxTime(e.target.value)} style={filterSelect}>
            <option value="">Egal</option>
            <option value="15">15 Min.</option>
            <option value="20">20 Min.</option>
            <option value="30">30 Min.</option>
            <option value="45">45 Min.</option>
            <option value="60">60 Min.</option>
            <option value="90">90 Min.</option>
          </select>
        </div>
        {/* Küche / Region */}
        <div style={{ flex: 1, minWidth: 100 }}>
          <label style={filterLabel}>🌍 Küche / Region</label>
          <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} style={filterSelect}>
            <option value="">Egal</option>
            <option value="Afrikanisch">Afrikanisch</option>
            <option value="Asiatisch">Asiatisch</option>
            <option value="Deutsch">Deutsch</option>
            <option value="Französisch">Französisch</option>
            <option value="Griechisch">Griechisch</option>
            <option value="Indisch">Indisch</option>
            <option value="Italienisch">Italienisch</option>
            <option value="Japanisch">Japanisch</option>
            <option value="Koreanisch">Koreanisch</option>
            <option value="Levantinisch">Levantinisch</option>
            <option value="Mexikanisch">Mexikanisch</option>
            <option value="Orientalisch">Orientalisch</option>
            <option value="Südamerikanisch">Südamerikanisch</option>
            <option value="Thai">Thai</option>
            <option value="Türkisch">Türkisch</option>
            <option value="Vietnamesisch">Vietnamesisch</option>
          </select>
        </div>
        {/* Ernährung */}
        <div style={{ flex: 1, minWidth: 100 }}>
          <label style={filterLabel}>🥩 Ernährung</label>
          <select value={diet} onChange={(e) => setDiet(e.target.value)} style={filterSelect}>
            <option value="">Egal</option>
            <option value="Fisch">Fisch</option>
            <option value="Fleisch">Fleisch</option>
            <option value="Vegetarisch">Vegetarisch</option>
            <option value="Vegan">Vegan</option>
          </select>
        </div>
      </div>

      {/* Submit */}
      <button
        disabled={!canSubmit}
        onClick={() => onSearch(query.trim(), image, maxTime, cuisine, diet)}
        style={{
          width: "100%", padding: "16px 24px", fontFamily: "'DM Sans',sans-serif", fontSize: 16, fontWeight: 700,
          background: canSubmit ? `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDark})` : COLORS.border,
          color: "#fff", border: "none", borderRadius: 14, cursor: canSubmit ? "pointer" : "not-allowed",
          transition: "all 0.25s", boxShadow: canSubmit ? "0 4px 20px rgba(212,101,74,0.3)" : "none",
        }}
      >
        🔍 Rezepte suchen
      </button>
    </div>
  );
}

// ==================== SUGGESTION CARDS ====================
function SuggestionScreen({ suggestions, onSelect, onBack }) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <button onClick={onBack} style={{
        background: "none", border: "none", fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: COLORS.accent,
        cursor: "pointer", marginBottom: 20, padding: 0, display: "flex", alignItems: "center", gap: 6,
      }}>← Neue Suche</button>
      <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "1.5rem", color: COLORS.text, marginBottom: 24 }}>
        3 Vorschläge für dich
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {suggestions.map((r, i) => (
          <div key={i} style={{
            background: COLORS.card, borderRadius: 16, padding: 24,
            boxShadow: "0 2px 16px rgba(60,40,30,0.07)", border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <h3 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "1.2rem", color: COLORS.text, margin: "0 0 8px" }}>{r.name}</h3>
                <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: COLORS.textLight, lineHeight: 1.5, margin: "0 0 12px" }}>{r.description}</p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                  <span style={tagStyle}>⏱ {r.time}</span>
                  <span style={tagStyle}>{r.difficulty}</span>
                </div>
              </div>
            </div>
            {/* Nährwerte */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {[
                ["kcal", r.nutrition?.kcal],
                ["Eiweiß", r.nutrition?.protein],
                ["Fett", r.nutrition?.fat],
                ["KH", r.nutrition?.carbs],
              ].map(([label, val]) => val && (
                <span key={label} style={{
                  fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 600, padding: "4px 10px",
                  borderRadius: 12, background: COLORS.legendBg, color: COLORS.textLight,
                }}>{label}: {val}</span>
              ))}
            </div>
            {/* Eiweiß-Info */}
            {r.proteinInfo && (
              <div style={{
                fontFamily: "'DM Sans',sans-serif", fontSize: 12, padding: "8px 12px", borderRadius: 10,
                background: COLORS.greenLight + "66", color: COLORS.green, marginBottom: 12, lineHeight: 1.4,
              }}>💪 {r.proteinInfo}</div>
            )}
            {r.source && (
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: COLORS.textLight, marginBottom: 12 }}>
                Quelle: {r.source}
              </div>
            )}
            <button onClick={() => onSelect(r)} style={{
              padding: "12px 24px", fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: 600,
              background: COLORS.accent, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer",
              transition: "all 0.2s",
            }}>Dieses Rezept wählen</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const tagStyle = {
  fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 500, padding: "4px 10px",
  borderRadius: 10, background: COLORS.legendBg, color: COLORS.textLight,
};
const filterLabel = {
  display: "block", fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 600,
  color: COLORS.textLight, marginBottom: 5, letterSpacing: 0.3,
};
const filterSelect = {
  width: "100%", fontFamily: "'DM Sans',sans-serif", fontSize: 14, padding: "10px 14px",
  border: `2px solid ${COLORS.border}`, borderRadius: 10, outline: "none",
  background: COLORS.card, color: COLORS.text, cursor: "pointer",
  boxSizing: "border-box", appearance: "auto",
};

// ==================== RECIPE CARD ====================
function RecipeCard({ recipe, onBack, onPrintRecipe, onPrintList }) {
  const basePortion = recipe.servings || 4;
  const [portions, setPortions] = useState(basePortion);
  const [checked, setChecked] = useState(() => recipe.ingredients.map(() => false));
  const [timers, setTimers] = useState({});
  const timerRefs = useRef({});

  const toggle = (i) => {
    const c = [...checked];
    c[i] = !c[i];
    setChecked(c);
  };

  const scale = (amount) => {
    if (!amount || amount === 0) return "";
    const s = (amount / basePortion) * portions;
    if (s === Math.floor(s)) return s.toString();
    const n = Math.round(s * 4) / 4;
    if (n === Math.floor(n)) return n.toString();
    const w = Math.floor(n);
    const f = n - w;
    let fs = "";
    if (Math.abs(f - 0.25) < 0.01) fs = "¼";
    else if (Math.abs(f - 0.5) < 0.01) fs = "½";
    else if (Math.abs(f - 0.75) < 0.01) fs = "¾";
    else fs = f.toFixed(1);
    return w > 0 ? `${w} ${fs}` : fs;
  };

  const haveCount = checked.filter(Boolean).length;
  const buyCount = checked.filter((c) => !c).length;

  const toggleTimer = (idx, secs) => {
    if (timers[idx]) {
      clearInterval(timerRefs.current[idx]);
      setTimers((t) => { const n = { ...t }; delete n[idx]; return n; });
      return;
    }
    setTimers((t) => ({ ...t, [idx]: { remaining: secs, running: true } }));
    timerRefs.current[idx] = setInterval(() => {
      setTimers((t) => {
        if (!t[idx]) return t;
        const rem = t[idx].remaining - 1;
        if (rem <= 0) {
          clearInterval(timerRefs.current[idx]);
          return { ...t, [idx]: { remaining: 0, running: false, done: true } };
        }
        return { ...t, [idx]: { ...t[idx], remaining: rem } };
      });
    }, 1000);
  };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", background: COLORS.card, minHeight: "100vh", boxShadow: "0 0 60px rgba(60,40,30,0.08)" }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentDark})`,
        padding: "44px 28px 36px", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, background: "rgba(255,255,255,0.06)", borderRadius: "50%" }} />
        <button onClick={onBack} style={{
          background: "rgba(255,255,255,0.18)", border: "none", color: "#fff", fontFamily: "'DM Sans',sans-serif",
          fontSize: 12, padding: "5px 14px", borderRadius: 20, cursor: "pointer", marginBottom: 14,
        }}>← Zurück</button>
        {recipe.tags && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {recipe.tags.map((t, i) => (
              <span key={i} style={{
                background: "rgba(255,255,255,0.18)", color: "#fff", fontSize: 11, fontWeight: 600,
                letterSpacing: 1.2, textTransform: "uppercase", padding: "4px 12px", borderRadius: 16,
                fontFamily: "'DM Sans',sans-serif",
              }}>{t}</span>
            ))}
          </div>
        )}
        <h1 style={{ fontFamily: "'DM Serif Display',serif", fontWeight: 400, fontSize: "1.8rem", color: "#fff", lineHeight: 1.2, margin: 0, position: "relative", zIndex: 1 }}>
          {recipe.name}
        </h1>
        <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
          {recipe.time && <span style={metaStyle}>⏱ {recipe.time}</span>}
          {recipe.difficulty && <span style={metaStyle}>✓ {recipe.difficulty}</span>}
          <span style={metaStyle}>👥 {portions} Portionen</span>
        </div>
      </div>

      <div style={{ padding: "28px 28px 40px" }}>
        {/* Portionenregler */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
          padding: 18, background: COLORS.legendBg, borderRadius: 14, marginBottom: 24,
        }}>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, color: COLORS.textLight, textTransform: "uppercase", letterSpacing: 0.8 }}>Portionen</span>
          <button onClick={() => setPortions(Math.max(1, portions - 1))} style={portionBtn}>−</button>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 26, color: COLORS.accent, minWidth: 32, textAlign: "center" }}>{portions}</span>
          <button onClick={() => setPortions(Math.min(20, portions + 1))} style={portionBtn}>+</button>
        </div>

        {/* Zutaten */}
        <h2 style={sectionTitle}>🧅 Zutaten</h2>
        <div style={{
          display: "flex", gap: 16, padding: "12px 16px", background: COLORS.legendBg, borderRadius: 10, marginBottom: 16, fontSize: 13,
          fontFamily: "'DM Sans',sans-serif",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: COLORS.green }} />
            <span>✓ Vorhanden</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${COLORS.border}`, background: "#fff" }} />
            <span>○ Einkaufen</span>
          </div>
        </div>

        {recipe.ingredients.map((ing, i) => (
          <div key={i} onClick={() => toggle(i)} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "11px 0",
            borderBottom: i < recipe.ingredients.length - 1 ? `1px solid ${COLORS.border}` : "none",
            cursor: "pointer", opacity: checked[i] ? 0.5 : 1, transition: "all 0.25s",
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6, flexShrink: 0,
              border: `2px solid ${checked[i] ? COLORS.green : COLORS.border}`,
              background: checked[i] ? COLORS.green : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s",
            }}>
              {checked[i] && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="4 12 10 18 20 6" /></svg>}
            </div>
            <span style={{
              fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 13, color: COLORS.accent,
              minWidth: 65, textAlign: "right", flexShrink: 0,
            }}>{scale(ing.amount)}{ing.unit ? ` ${ing.unit}` : ""}</span>
            <span style={{
              fontFamily: "'DM Sans',sans-serif", fontSize: 14, flex: 1,
              textDecoration: checked[i] ? "line-through" : "none", color: checked[i] ? COLORS.textLight : COLORS.text,
            }}>{ing.name}</span>
          </div>
        ))}

        {/* Zusammenfassung */}
        <div style={{
          display: "flex", gap: 10, padding: 14, background: COLORS.legendBg, borderRadius: 10,
          marginTop: 12, marginBottom: 32, justifyContent: "center", flexWrap: "wrap",
        }}>
          <span style={{ ...chipStyle, background: COLORS.greenLight, color: "#2D6B3F" }}>● {haveCount} vorhanden</span>
          <span style={{ ...chipStyle, background: COLORS.orangeLight, color: "#9A5A10" }}>● {buyCount} einkaufen</span>
        </div>

        {/* Zubereitung */}
        <h2 style={sectionTitle}>🍳 Zubereitung</h2>
        {recipe.steps?.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 14, marginBottom: 22 }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", background: COLORS.accent, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13,
              flexShrink: 0, marginTop: 2, fontFamily: "'DM Sans',sans-serif",
            }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, lineHeight: 1.6, margin: 0 }}>{step.text}</p>
              {step.timer && (
                <div onClick={() => toggleTimer(i, step.timer)} style={{
                  display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 8,
                  marginTop: 8, cursor: "pointer", userSelect: "none", transition: "all 0.2s",
                  ...(timers[i]?.done
                    ? { background: COLORS.green, color: "#fff" }
                    : timers[i]?.running
                    ? { background: COLORS.accent, color: "#fff" }
                    : { background: COLORS.timerBg, border: `1px solid ${COLORS.accentLight}` }),
                }}>
                  <span>⏱</span>
                  <span style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: "tabular-nums", fontFamily: "'DM Sans',sans-serif" }}>
                    {timers[i] ? fmtTime(timers[i].remaining) : fmtTime(step.timer)}
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.8, fontFamily: "'DM Sans',sans-serif" }}>
                    {timers[i]?.done ? "Fertig! ✓" : timers[i]?.running ? "läuft…" : "Timer starten"}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Tipps */}
        {recipe.tips && (
          <div style={{
            background: COLORS.tipBg, borderLeft: `4px solid ${COLORS.green}`,
            borderRadius: "0 12px 12px 0", padding: "18px 22px", marginTop: 28,
          }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13, color: COLORS.green, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>💡 Tipps</div>
            <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, lineHeight: 1.6, color: COLORS.textLight, margin: 0 }}>{recipe.tips}</p>
          </div>
        )}

        {/* Eiweiß-Info */}
        {recipe.proteinInfo && (
          <div style={{
            background: COLORS.greenLight + "44", borderRadius: 12, padding: "14px 18px", marginTop: 16,
          }}>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: COLORS.green }}>💪 <strong>Eiweiß-Info:</strong> {recipe.proteinInfo}</span>
          </div>
        )}

        {/* Nährwerte */}
        {recipe.nutrition && (
          <div style={{
            display: "flex", gap: 6, padding: 18, background: COLORS.legendBg, borderRadius: 14,
            marginTop: 24, justifyContent: "space-around", flexWrap: "wrap",
          }}>
            {[
              [recipe.nutrition.kcal, "KCAL"],
              [recipe.nutrition.protein, "EIWEIẞ"],
              [recipe.nutrition.fat, "FETT"],
              [recipe.nutrition.carbs, "KH"],
              [recipe.nutrition.fiber, "BALLAST."],
            ].filter(([v]) => v).map(([v, l]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: "1.1rem", color: COLORS.accent }}>{v}</div>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: COLORS.textLight, letterSpacing: 0.5 }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 32 }}>
          <button onClick={() => onPrintRecipe(recipe, checked)} style={actionBtn(COLORS.accent)}>
            🖨️ Rezept-PDF drucken
          </button>
          <button onClick={() => onPrintList(recipe, checked)} style={actionBtn(COLORS.orange)}>
            🛒 Einkaufsliste drucken
          </button>
          <button onClick={onBack} style={{
            ...actionBtn(COLORS.card),
            color: COLORS.accent, border: `2px solid ${COLORS.accent}`,
          }}>
            🔍 Neues Rezept suchen
          </button>
        </div>
      </div>
    </div>
  );
}

const metaStyle = { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 5 };
const sectionTitle = { fontFamily: "'DM Serif Display',serif", fontSize: "1.3rem", color: COLORS.text, marginBottom: 16 };
const chipStyle = { fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 20 };
const portionBtn = {
  width: 38, height: 38, borderRadius: "50%", border: `2px solid ${COLORS.accent}`, background: "transparent",
  color: COLORS.accent, fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center",
  justifyContent: "center", fontFamily: "'DM Sans',sans-serif",
};
const actionBtn = (bg) => ({
  width: "100%", padding: "14px 24px", fontFamily: "'DM Sans',sans-serif", fontSize: 15, fontWeight: 600,
  background: bg, color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", transition: "all 0.2s",
});

// ==================== PDF PRINT VIA NEW WINDOW ====================
function printHTML(html) {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) { alert("Bitte Pop-ups erlauben für den PDF-Druck."); return; }
  w.document.write(html);
  w.document.close();
  w.onload = () => { w.print(); };
}

function buildRecipePrintHTML(recipe, checked, portions) {
  const scale = (amt) => {
    if (!amt) return "";
    const s = (amt / (recipe.servings || 4)) * portions;
    if (s === Math.floor(s)) return s.toString();
    return (Math.round(s * 4) / 4).toString();
  };
  const ings = recipe.ingredients.map((ing, i) => {
    const have = checked[i];
    return `<tr style="opacity:${have ? 0.5 : 1}">
      <td style="padding:6px 8px;text-align:center;font-size:18px">${have ? "☑" : "☐"}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:600;color:#D4654A;white-space:nowrap">${scale(ing.amount)}${ing.unit ? " " + ing.unit : ""}</td>
      <td style="padding:6px 8px;${have ? "text-decoration:line-through;color:#999" : ""}">${ing.name}</td>
      <td style="padding:6px 8px;font-size:12px;color:#888">${have ? "vorhanden" : "einkaufen"}</td>
    </tr>`;
  }).join("");
  const steps = recipe.steps?.map((s, i) => `<li style="margin-bottom:10px;line-height:1.6">${s.text}${s.timer ? ` <em style="color:#E8913A">(${Math.floor(s.timer / 60)} Min.)</em>` : ""}</li>`).join("") || "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${recipe.name}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Serif+Display&display=swap');
body{font-family:'DM Sans',sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#3B2F2F}
h1{font-family:'DM Serif Display',serif;color:#D4654A;margin-bottom:4px}
h2{font-family:'DM Serif Display',serif;margin-top:28px}
table{width:100%;border-collapse:collapse}
tr{border-bottom:1px solid #E8DDD5}
@media print{body{padding:12px}}</style></head><body>
<h1>${recipe.name}</h1>
<p style="color:#7A6B6B;font-size:14px">${recipe.time || ""} · ${recipe.difficulty || ""} · ${portions} Portionen</p>
<h2>Zutaten</h2>
<table>${ings}</table>
<h2>Zubereitung</h2><ol style="padding-left:20px;font-size:14px">${steps}</ol>
${recipe.tips ? `<div style="background:#F0F7F1;border-left:4px solid #5A9E6F;padding:14px 18px;border-radius:0 10px 10px 0;margin-top:24px"><strong style="color:#5A9E6F">💡 Tipps:</strong><br><span style="font-size:13px;color:#7A6B6B">${recipe.tips}</span></div>` : ""}
${recipe.nutrition ? `<div style="display:flex;gap:20px;margin-top:24px;padding:16px;background:#FAF5F2;border-radius:10px;justify-content:space-around;flex-wrap:wrap">${[["kcal","KCAL"],["protein","EIWEIẞ"],["fat","FETT"],["carbs","KH"],["fiber","BALLAST."]].filter(([k])=>recipe.nutrition[k]).map(([k,l])=>`<div style="text-align:center"><div style="font-family:'DM Serif Display',serif;font-size:1.1rem;color:#D4654A">${recipe.nutrition[k]}</div><div style="font-size:10px;color:#7A6B6B">${l}</div></div>`).join("")}</div>` : ""}
<p style="text-align:center;font-size:11px;color:#aaa;margin-top:32px">Erstellt mit Rezept-Finder</p>
</body></html>`;
}

function buildShoppingPrintHTML(recipe, checked, portions) {
  const scale = (amt) => {
    if (!amt) return "";
    const s = (amt / (recipe.servings || 4)) * portions;
    if (s === Math.floor(s)) return s.toString();
    return (Math.round(s * 4) / 4).toString();
  };
  const toBuy = recipe.ingredients.map((ing, i) => ({ ...ing, idx: i })).filter((_, i) => !checked[i]);
  if (toBuy.length === 0) return null;
  const rows = toBuy.map((ing) => `<tr>
    <td style="padding:8px 10px;font-size:20px">☐</td>
    <td style="padding:8px 10px;text-align:right;font-weight:600;white-space:nowrap">${scale(ing.amount)}${ing.unit ? " " + ing.unit : ""}</td>
    <td style="padding:8px 10px;font-size:15px">${ing.name}</td>
  </tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Einkaufsliste – ${recipe.name}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Serif+Display&display=swap');
body{font-family:'DM Sans',sans-serif;max-width:500px;margin:0 auto;padding:24px;color:#3B2F2F}
h1{font-family:'DM Serif Display',serif;color:#E8913A;font-size:1.4rem}
h2{font-family:'DM Serif Display',serif;font-size:1.1rem;margin-top:20px}
table{width:100%;border-collapse:collapse}
tr{border-bottom:1px solid #E8DDD5}
@media print{body{padding:12px}}</style></head><body>
<h1>🛒 Einkaufsliste</h1>
<p style="color:#7A6B6B;font-size:13px">für: ${recipe.name} (${portions} Portionen) · ${toBuy.length} Artikel</p>
<table>${rows}</table>
<p style="text-align:center;font-size:11px;color:#aaa;margin-top:40px">Erstellt mit Rezept-Finder</p>
</body></html>`;
}

// ==================== SETTINGS PANEL ====================
function SettingsPanel({ apiKey, onSave, onClose }) {
  const [value, setValue] = useState(apiKey || "");
  const [show, setShow] = useState(false);

  const masked = (k) => {
    if (!k) return "";
    if (k.length < 12) return "•".repeat(k.length);
    return k.slice(0, 8) + "•".repeat(Math.max(0, k.length - 12)) + k.slice(-4);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.card, borderRadius: 16, padding: 28, maxWidth: 480, width: "100%",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)", fontFamily: "'DM Sans',sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: "'DM Serif Display',serif", fontSize: "1.4rem", color: COLORS.text, margin: 0 }}>
            ⚙️ Einstellungen
          </h2>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: "50%", border: "none", background: COLORS.legendBg,
            color: COLORS.textLight, fontSize: 16, cursor: "pointer",
          }}>✕</button>
        </div>

        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>
          Claude API-Key
        </label>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-ant-api03-..."
            style={{
              width: "100%", padding: "10px 40px 10px 14px", fontSize: 13,
              border: `2px solid ${COLORS.border}`, borderRadius: 10, outline: "none",
              fontFamily: "monospace", boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => setShow(!show)}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 4,
            }}
            title={show ? "Ausblenden" : "Anzeigen"}
          >{show ? "🙈" : "👁"}</button>
        </div>

        {apiKey && !value && (
          <div style={{ fontSize: 12, color: COLORS.textLight, marginBottom: 10 }}>
            Aktuell gespeichert: <code>{masked(apiKey)}</code>
          </div>
        )}

        <div style={{
          fontSize: 12, color: COLORS.textLight, lineHeight: 1.5, marginBottom: 16,
          padding: 12, background: COLORS.legendBg, borderRadius: 8,
        }}>
          Der Key wird nur lokal in deinem Browser gespeichert und nicht hochgeladen.
          Einen Key kannst du kostenpflichtig auf <strong>console.anthropic.com</strong> erstellen
          (separates Konto, nicht dein Claude-Chat-Abo).
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { onSave(value.trim()); onClose(); }}
            style={{
              flex: 1, padding: "12px 20px", fontSize: 14, fontWeight: 600,
              background: COLORS.accent, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer",
              fontFamily: "'DM Sans',sans-serif",
            }}
          >💾 Speichern</button>
          {apiKey && (
            <button
              onClick={() => { onSave(""); setValue(""); }}
              style={{
                padding: "12px 20px", fontSize: 14, fontWeight: 600,
                background: "transparent", color: COLORS.textLight, border: `2px solid ${COLORS.border}`,
                borderRadius: 10, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
              }}
            >Löschen</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN APP ====================
export default function App() {
  const [screen, setScreen] = useState("search"); // search | loading | suggestions | loadingRecipe | recipe | loadingPdf
  const [suggestions, setSuggestions] = useState([]);
  const [recipe, setRecipe] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(LOADING_SEARCH);
  const [portions, setPortions] = useState(4);
  const lastChecked = useRef([]);

  // API-Key: aus localStorage laden, bei Änderung speichern
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem("rezept_finder_api_key") || "";
    } catch {
      return "";
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const saveApiKey = (key) => {
    setApiKey(key);
    try {
      if (key) localStorage.setItem("rezept_finder_api_key", key);
      else localStorage.removeItem("rezept_finder_api_key");
    } catch {}
  };

  const doSearch = async (query, image, maxTime, cuisine, diet) => {
    setScreen("loading");
    setLoadingMessages(LOADING_SEARCH);
    setError(null);
    try {
      const filters = [];
      if (maxTime) filters.push(`Maximale Zubereitungszeit: ${maxTime} Minuten.`);
      if (cuisine) filters.push(`Küche/Region: ${cuisine}.`);
      if (diet) filters.push(`Ernährungsform: ${diet}. Nur Rezepte mit ${diet === "Fisch" ? "Fisch (kein Fleisch)" : diet === "Fleisch" ? "Fleisch" : diet === "Vegetarisch" ? "vegetarischen Zutaten (kein Fisch, kein Fleisch)" : "veganen Zutaten (keine tierischen Produkte)"}.`);
      const filterText = filters.length > 0 ? `\nWICHTIGE FILTER: ${filters.join(" ")} Halte dich strikt daran.` : "";

      const sysPrompt = `Du bist ein Rezept-Experte. Suche im Internet nach 3 passenden Rezepten basierend auf der Anfrage.${filterText}
Achte IMMER auf vollständige Eiweißbausteine (essenzielle Aminosäuren) und schlage ggf. Ergänzungen vor.
Antworte NUR mit einem JSON-Array (keine Erklärung davor/danach), Format:
[{
  "name": "Rezeptname",
  "description": "Kurzbeschreibung 2-3 Sätze",
  "time": "30 Min.",
  "difficulty": "Einfach",
  "nutrition": {"kcal":"350","protein":"22g","fat":"14g","carbs":"30g"},
  "proteinInfo": "Kichererbsen + Ei = vollständiges Eiweiß",
  "source": "website.de"
}]
Alle Texte auf Deutsch. Nährwerte pro Portion schätzen.`;

      const userContent = [];
      if (image) {
        userContent.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
      }
      userContent.push({ type: "text", text: query || (image ? "Lies dieses Rezeptfoto und schlage 3 Varianten vor." : "Schlage 3 proteinreiche Rezepte vor.") + (maxTime ? ` Maximal ${maxTime} Minuten Zubereitungszeit.` : "") + (cuisine ? ` Küche: ${cuisine}.` : "") + (diet ? ` Ernährung: ${diet}.` : "") });

      const onRetry = (attempt, secs) => {
        setError(`API-Limit erreicht. Versuche es automatisch in ${secs} Sek. erneut (Versuch ${attempt})...`);
      };

      const raw = await callClaude(apiKey, sysPrompt, userContent, true, onRetry);
      setError(null);
      const data = extractJSON(raw);
      const arr = Array.isArray(data) ? data : [data];
      setSuggestions(arr.slice(0, 3));
      setScreen("suggestions");
    } catch (e) {
      setError(e.message);
      setScreen("search");
    }
  };

  const doSelectRecipe = async (suggestion) => {
    setScreen("loadingRecipe");
    setLoadingMessages(LOADING_RECIPE);
    setError(null);
    try {
      const sysPrompt = `Du bist ein Rezept-Experte für Ernährung ab 60 (DGE/WHO/EFSA).
Gib das vollständige Rezept NUR als JSON zurück:
{
  "name": "...",
  "tags": ["Proteinreich","Calciumreich"],
  "time": "30 Min.",
  "difficulty": "Einfach",
  "servings": 4,
  "ingredients": [{"amount":2,"unit":"EL","name":"Olivenöl"}],
  "steps": [{"text":"...","timer":null},{"text":"10 Min. köcheln","timer":600}],
  "tips": "... oder null",
  "proteinInfo": "Ernährungs-Info 60+ (max. 2-3 Sätze)",
  "nutrition": {"kcal":"350","protein":"22g","fat":"14g","carbs":"30g","fiber":"8g"}
}
Einheiten: EL, TL, g, Stk., Bund, Dose, ml. Timer in Sekunden. Alles auf Deutsch. Nutze dein Fachwissen — keine Web-Suche nötig.`;

      const onRetry = (attempt, secs) => {
        setError(`API-Limit erreicht. Versuche es automatisch in ${secs} Sek. erneut (Versuch ${attempt})...`);
      };

      const raw = await callClaude(
        apiKey,
        sysPrompt,
        [{ type: "text", text: `Rezept: "${suggestion.name}". ${suggestion.description}` }],
        false,
        onRetry
      );
      setError(null);
      const data = extractJSON(raw);
      setRecipe(data);
      setPortions(data.servings || 4);
      setScreen("recipe");
    } catch (e) {
      setError(e.message);
      setScreen("suggestions");
    }
  };

  const handlePrintRecipe = (rec, checked) => {
    lastChecked.current = checked;
    const html = buildRecipePrintHTML(rec, checked, portions);
    printHTML(html);
  };

  const handlePrintList = (rec, checked) => {
    const html = buildShoppingPrintHTML(rec, checked, portions);
    if (!html) { alert("Alle Zutaten sind als vorhanden markiert — nichts einzukaufen!"); return; }
    printHTML(html);
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />

      {/* Zahnrad oben rechts für Einstellungen */}
      <button
        onClick={() => setSettingsOpen(true)}
        title="Einstellungen"
        style={{
          position: "fixed", top: 12, right: 12, zIndex: 90,
          width: 44, height: 44, borderRadius: "50%", border: "none",
          background: apiKey ? COLORS.card : COLORS.orangeLight,
          boxShadow: "0 2px 12px rgba(60,40,30,0.12)",
          cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center",
          color: COLORS.text,
        }}
      >
        {apiKey ? "⚙️" : "🔑"}
      </button>

      {/* Hinweis-Banner, wenn kein Key hinterlegt ist */}
      {!apiKey && (
        <div style={{
          background: COLORS.orangeLight, color: "#7A4A10", padding: "10px 64px 10px 20px",
          fontSize: 13, fontFamily: "'DM Sans',sans-serif", textAlign: "center",
          borderBottom: `1px solid ${COLORS.orange}`,
        }}>
          Kein API-Key hinterlegt. Oben rechts auf 🔑 klicken, um einen einzutragen.
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          apiKey={apiKey}
          onSave={saveApiKey}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {error && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 100,
          background: "#FEE", border: "1px solid #D44", borderRadius: 12, padding: "12px 20px",
          fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#922", maxWidth: 500, boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
        }}>
          <strong>Fehler:</strong> {error}
          <button onClick={() => setError(null)} style={{
            marginLeft: 12, background: "none", border: "none", color: "#922", cursor: "pointer", fontWeight: 700,
          }}>✕</button>
        </div>
      )}

      {screen === "search" && <SearchScreen onSearch={doSearch} />}
      {screen === "loading" && <LoadingScreen messages={loadingMessages} />}
      {screen === "suggestions" && <SuggestionScreen suggestions={suggestions} onSelect={doSelectRecipe} onBack={() => setScreen("search")} />}
      {screen === "loadingRecipe" && <LoadingScreen messages={loadingMessages} />}
      {screen === "recipe" && recipe && (
        <RecipeCard
          recipe={recipe}
          onBack={() => setScreen("search")}
          onPrintRecipe={handlePrintRecipe}
          onPrintList={handlePrintList}
        />
      )}
    </div>
  );
}
