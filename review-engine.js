/* Local, deterministic checks. No storage, requests, evaluation or semantic AI. */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ documents: 12, text: 100000, facts: 160, factText: 4000, proposals: 200 });
  const TYPES = new Set(['pm', 'daf_basis', 'daf_event', 'portal', 'fritext', 'interview']);
  const HEADINGS = ['INLEDNING', 'BROTT', 'OMSTÄNDIGHETER', 'ÖVERVAKNINGSKAMEROR', 'BILAGOR'];
  const TIME_KEYS = new Set(['plDecisionTime', 'findingTime', 'custodyDecisionTime', 'cellEntryTime',
    'event.pl_decision', 'event.finding', 'event.custody_decision', 'event.cell_entry']);
  const TIME_ALIAS = { 'event.pl_decision': 'plDecisionTime', 'event.finding': 'findingTime',
    'event.custody_decision': 'custodyDecisionTime', 'event.cell_entry': 'cellEntryTime' };
  const KEY_LABELS = Object.freeze({
    kNumber: 'K-nummer', date: 'Datum', incidentPlace: 'Ingripandeplats', crimePlace: 'Brottsplats',
    findingPlace: 'Fyndplats', arrestPlace: 'Arrestplats', interviewPlace: 'Förhörsplats',
    decisionMaker: 'Beslutsfattare', executor: 'Verkställare', count: 'Antal / mängd',
    plDecisionTime: 'Tid för PL-beslut', findingTime: 'Tid för fynd',
    custodyDecisionTime: 'Tid för förvarsbeslut', cellEntryTime: 'Tid för insättning'
  });
  const keyLabel = key => Object.prototype.hasOwnProperty.call(KEY_LABELS, key) ? KEY_LABELS[key] : key || 'ospecificerad uppgift';
  const str = value => value == null ? '' : String(value);
  const fold = value => str(value).trim().toLocaleLowerCase('sv');
  const canonical = value => str(value).trim().replace(/\s+/g, ' ');
  const uniq = items => [...new Set(items)];

  function hasWholeValue(excerpt, value) {
    if (!value) return false;
    const wordCharacter = char => Boolean(char && /[\p{L}\p{N}_]/u.test(char));
    let at = excerpt.indexOf(value);
    while (at !== -1) {
      if (!(wordCharacter(value[0]) && wordCharacter(excerpt[at - 1])) &&
          !(wordCharacter(value[value.length - 1]) && wordCharacter(excerpt[at + value.length]))) return true;
      at = excerpt.indexOf(value, at + 1);
    }
    return false;
  }

  function bounded(value, max, label) {
    const text = str(value);
    if (text.length > max) throw new RangeError(label + ' överskrider gränsen ' + max + ' tecken.');
    return text;
  }
  function dateValue(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const n = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? value : null;
  }
  function occurrence(text, pattern) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    return match ? { quote: match[0], start: match.index, end: match.index + match[0].length } : {};
  }
  function lines(text) {
    const result = [];
    const regex = /[^\r\n]+/g;
    let match;
    while ((match = regex.exec(text))) result.push({ text: match[0], start: match.index });
    return result;
  }

  function review(input) {
    input = input && typeof input === 'object' ? input : {};
    const rawDocs = Array.isArray(input.documents) ? input.documents : [];
    const rawFacts = Array.isArray(input.facts) ? input.facts : [];
    if (rawDocs.length > LIMITS.documents) throw new RangeError('Högst 12 dokument kan granskas samtidigt.');
    if (rawFacts.length > LIMITS.facts) throw new RangeError('Högst 160 faktarader kan jämföras samtidigt.');
    const originalCase = bounded(input.originalCase, LIMITS.text, 'Originalcase');
    const referenceDate = dateValue(str(input.referenceDate));
    const lawDate = dateValue(str(input.lawDate));
    const ids = new Set(['case']);
    const documents = rawDocs.map((item, index) => {
      item = item || {};
      const id = bounded(item.id || 'document-' + (index + 1), 120, 'Dokument-id');
      if (ids.has(id)) throw new TypeError('Dokument-id måste vara unika och får inte vara case.');
      ids.add(id);
      if (!TYPES.has(item.type)) throw new TypeError('Okänd dokumenttyp: ' + str(item.type));
      return { id, type: item.type, intervention: str(item.intervention),
        text: bounded(item.text, LIMITS.text, 'Dokumenttext'),
        basis: Object.fromEntries(['law', 'offence', 'grounds'].map(key =>
          [key, bounded(item.basis && item.basis[key], LIMITS.factText, 'Grundfält').trim()])) };
    });
    const sourceTexts = new Map([['case', originalCase], ...documents.map(doc => [doc.id, doc.text])]);
    const sourceLabels = new Map([['case', 'Originalcase'], ...documents.map((doc, index) => [doc.id, 'Handling ' + (index + 1)])]);
    const sourceLabel = source => sourceLabels.get(source) || 'Okänd källa';
    const findings = [], proposals = [], completions = [], comparisons = [], derivedDrafts = [];
    const limitations = [
      'Lokal regelkontroll utan AI. Fritext förstås inte semantiskt och är inte sakligt eller juridiskt verifierad.',
      'Exakta källcitat visar var en angiven faktarad förekommer. De bevisar inte att tolkningen, rollen eller händelsen är rätt.',
      'Jämförelser kräver samma uppgiftstyp, person/objekt och händelse. Du ansvarar för dessa avgränsningar.',
      'Kontrollfrågor är signaler för manuell granskning, inte konstaterade fel eller examinationskrav.'
    ];
    if (!originalCase.trim()) limitations.push('Originalcase saknas: endast dokumentstruktur, regelindikatorer och interna faktajämförelser kan kontrolleras.');
    else limitations.push('Originalcase finns men verifieras inte som fri text. Registrera belagda faktarader för avgränsade jämförelser.');
    if (!lawDate) limitations.push('Giltigt lagdatum saknas: laghänvisningar måste bedömas mot händelsedatum och övergångsbestämmelser.');
    let sequence = 0;
    function add(doc, category, severity, title, explanation, ruleIds, hit, suggestion) {
      const finding = { id: 'finding-' + (++sequence), category, severity, title,
        quote: hit && hit.quote || '', explanation, suggestion: suggestion || 'Stäm av det citerade textstället mot källan och komplettera endast med belagda uppgifter.', ruleIds };
      if (doc) finding.documentId = doc.id;
      if (hit && Number.isInteger(hit.start)) { finding.start = hit.start; finding.end = hit.end; }
      findings.push(finding);
      return finding;
    }
    function complete(text) { if (!completions.includes(text)) completions.push(text); }
    function proposal(doc, start, end, after, label, explanation, ruleIds) {
      if (doc.text.slice(start, end) === after) return;
      if (proposals.length >= LIMITS.proposals) {
        const limitNote = 'Högst 200 formatförslag visas per granskning. Ytterligare möjliga formatändringar har inte tagits med.';
        if (!limitations.includes(limitNote)) limitations.push(limitNote);
        return;
      }
      if (proposals.some(p => p.documentId === doc.id && start < p.end && end > p.start)) return;
      proposals.push({ id: 'proposal-' + (proposals.length + 1), documentId: doc.id, start, end,
        before: doc.text.slice(start, end), after, label, explanation, ruleIds });
    }
    function question(doc, pattern, category, title, explanation, ruleIds, suggestion) {
      const hit = occurrence(doc.text, pattern);
      if (hit.quote) add(doc, category, 'check', 'Kontrollfråga: ' + title, explanation, ruleIds, hit, suggestion);
    }

    if (input.referenceDate && !referenceDate) add(null, 'missing', 'check', 'Referensdatum kan inte tolkas', 'Ange ett verkligt datum som ÅÅÅÅ-MM-DD. Relativa datum har inte räknats om.', ['R07'], null, 'Kontrollera referensdatumet.');
    if (input.lawDate && !lawDate) add(null, 'legal', 'check', 'Lagdatum kan inte tolkas', 'Ange ett verkligt datum som ÅÅÅÅ-MM-DD. Ingen aktuell lagversion har valts automatiskt.', ['R31'], null, 'Kontrollera datumet för rättsläget.');
    if (/\bigår\b/i.test(originalCase) && !referenceDate) {
      add(null, 'missing', 'check', 'Kontrollfråga: vilket datum avser ”igår” i caset?', 'Originalcaset innehåller ett relativt datum. Det räknas inte om med dagens datum.', ['R07'], occurrence(originalCase, /\bigår\b/i), 'Ange casets referensdatum.');
      complete('Fastställ referensdatum för relativa datum i originalcaset.');
    }
    for (const doc of documents) {
      const text = doc.text;
      const name = sourceLabel(doc.id);
      if (!text.trim()) {
        add(doc, 'missing', 'check', 'Dokumenttext saknas', 'Ingen dokumenttext har lämnats för denna kontroll.', ['R05'], null, 'Klistra in dokumentets utkast.');
        complete(name + ': lägg in text.');
        continue;
      }
      // Exact, complete headings only: never change words inside a statement or quotation.
      if (doc.type === 'fritext') {
        const found = new Set();
        for (const line of lines(text)) {
          const match = /^([ \t]*)(inledning|brott|omständigheter|övervakningskameror|bilagor)(:?)([ \t]*)$/i.exec(line.text);
          if (!match) continue;
          const heading = match[2].toLocaleUpperCase('sv');
          found.add(heading);
          if (match[2] !== heading) {
            const start = line.start + match[1].length;
            const after = heading;
            proposal(doc, start, start + match[2].length, after, 'Rubrik med versaler', 'Ändrar endast bokstavsstorlek på en fristående känd rubrik.', ['R09', 'R58']);
          }
        }
        const missing = HEADINGS.filter(h => !found.has(h));
        if (missing.length) {
          add(doc, 'structure', 'check', 'Kontrollfråga: fritextens rubriker', 'Följande fristående rubriker kunde inte identifieras: ' + missing.join(', ') + '. Innehåll under rubrikerna behöver bedömas manuellt.', ['R09'], null, 'Kontrollera rubrikerna och fyll endast i belagda uppgifter.');
          complete(name + ': kontrollera rubrikerna ' + missing.join(', ') + '.');
        }
      }
      // Trailing spaces only. No punctuation, names, numbers, tense or quotation edits.
      for (const line of lines(text)) {
        const trailing = /[ \t]+$/.exec(line.text);
        if (trailing && line.text.trim()) proposal(doc, line.start + trailing.index, line.start + line.text.length, '', 'Ta bort blanksteg sist på raden', 'Ändrar endast avslutande blanksteg. Originalet finns kvar.', ['R37', 'R58']);
      }
      if (proposals.some(p => p.documentId === doc.id)) add(doc, 'language', 'note', 'Valbara formatförslag', 'Endast identifierade rubriker och avslutande blanksteg har fått formatförslag. Sakuppgifter ändras inte.', ['R01', 'R37', 'R58'], null, 'Godkänn enbart de förslag du vill använda.');

      if (['pm', 'portal', 'interview'].includes(doc.type) && !/(?:\b\d{3,4}-K\d+|\bK[ -]?(?:nr|nummer)?\s*[:#-]?\s*\d+|\[K-nr\])/i.test(text)) {
        add(doc, 'missing', 'check', 'Kontrollfråga: K-nummer', 'Ett tydligt K-nummer eller platshållaren [K-nr] kunde inte identifieras. Uppgiften kan finnas i ett separat systemfält.', ['R47', 'R56'], null, 'Kontrollera rätt K-nummer mot caset eller markera [K-nr] där det behövs.');
        complete(name + ': kontrollera om K-nummer ska anges i text eller separat fält.');
      }
      if (['pm', 'daf_event', 'portal', 'interview'].includes(doc.type)) {
        if (!/(?:\b\d{4}-\d{2}-\d{2}\b|\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[012])(?:\/\d{2,4})?\b|\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[012])\.\d{4}\b|\b\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/i.test(text)) {
          add(doc, 'missing', 'check', 'Kontrollfråga: datum', 'Ett tydligt kalenderdatum kunde inte identifieras. Detta är en mönsterkontroll; datum kan finnas i ett separat fält.', ['R07', 'R43', 'R47'], null, 'Kontrollera vilket datum uppgifterna avser.');
          complete(name + ': kontrollera datum och eventuella separata datumfält.');
        }
        if (!/(?:plats|adress|gata|gatan|väg|vägen|torg|torget|station|bostad|lägenhet|parkering|korsning|\bpå\s+\S+|\bvid\s+\S+)/i.test(text)) {
          add(doc, 'missing', 'check', 'Kontrollfråga: plats', 'Ingen enkel platsmarkör identifierades. Motorn kan inte avgöra vilken plats som är relevant eller om den finns i ett systemfält.', ['R44', 'R47'], null, 'Kontrollera händelseplats och andra relevanta platser var för sig.');
          complete(name + ': kontrollera relevanta platsuppgifter och deras roller.');
        }
      }
      if (/\bigår\b/i.test(text)) {
        add(doc, 'missing', 'check', 'Kontrollfråga: relativt datum', referenceDate ? '”Igår” förekommer. Angivet referensdatum är ' + referenceDate + ', men motorn ersätter inte datum eller verifierar vad formuleringen avser.' : '”Igår” förekommer utan ett giltigt referensdatum. Dagens datum används inte som antagande.', ['R07'], occurrence(text, /\bigår\b/i), 'Stäm av rätt kalenderdatum mot caset.');
      }
      if (doc.type === 'daf_basis') {
        if (text.length > 350 || text.split(/\s+/).length > 55) add(doc, 'structure', 'note', 'Signal: ingripandegrunden kan behöva kortas', 'Texten passerar verktygets signalgräns (350 tecken eller 55 ord). Detta är inte ett ordantal eller bedömningskrav från examinationen. Skilj grund från händelsebeskrivning.', ['R13'], null, 'Behåll lagrum och konkret beslutsgrund; granska separat vad som hör till händelsen.');
        const parts = ['law', 'offence', 'grounds'].map(key => doc.basis[key]).filter(Boolean);
        if (parts.length) {
          const allPresent = parts.every(part => text.includes(part));
          if (!allPresent) {
            add(doc, 'missing', 'check', 'Grundfält saknar exakt stöd i originaltexten', 'Minst en angiven komponent förekommer inte ordagrant i dokumentets originaltext. Ingen kortversion skapas.', ['R01', 'R05', 'R13'], null, 'Kontrollera grundfälten mot originalet.');
          } else {
            let remainder = text;
            for (const part of [...parts].sort((a, b) => b.length - a.length)) remainder = remainder.replace(part, '');
            remainder = remainder.replace(/(?:lagrum|brott|grund|omständigheter|ingripandegrund)\s*:/gi, '').replace(/[\s,;:.–—-]/g, '');
            const compact = parts.join('; ');
            if (!remainder && compact.length < text.length) proposal(doc, 0, text.length, compact, 'Kortare presentation av ingripandegrunden', 'Använder endast ordagranna grundkomponenter. Endast angivna fältetiketter och avskiljare tas bort. Juridisk tillräcklighet är inte bedömd.', ['R01', 'R13', 'R14', 'R58']);
            else if (remainder) {
              add(doc, 'structure', 'note', 'Kortversion kräver manuell avgränsning', 'Grundkomponenterna finns ordagrant, men originaltexten innehåller mer text. Motorn tar inte bort den eftersom den kan bära sakuppgifter.', ['R01', 'R13'], null, 'Avgränsa grund och händelse manuellt med originalet kvar.');
              if (doc.basis.law && doc.basis.grounds && (doc.intervention !== 'gripande' || doc.basis.offence) && compact.length < text.length) {
                derivedDrafts.push({ documentId: doc.id, title: 'Separat utkast till kort ingripandegrund', text: compact,
                  explanation: 'Utkastet kombinerar endast dina ordagranna grundfält. Motorn har inte bedömt om grunden är juridiskt riktig eller tillräcklig. Originalet ersätts inte. Bevara övriga relevanta sakuppgifter och hela förloppet i händelsebeskrivningen; kontrollera att inget försvinner vid en manuell överföring.',
                  ruleIds: ['R01', 'R13', 'R14', 'R15', 'R58'] });
                complete(name + ': bedöm det separata grundutkastet och bevara relevanta sakuppgifter i händelsebeskrivningen.');
              }
            }
          }
        }
      }
      if (doc.type === 'daf_event' && /^\s*se\s+(?:bifogat\s+)?pm[.!\s]*$/i.test(text)) add(doc, 'missing', 'check', 'Händelsetexten hänvisar bara till PM', 'DAF:s händelse behöver enligt manualen beskrivas, inte endast hänvisas bort.', ['R15'], { quote: text, start: 0, end: text.length }, 'Komplettera med belagt förlopp, beslut, aktörer och resultat.');
      question(doc, /se\s+(?:bifogat\s+)?pm/gi, 'missing', 'finns det PM som hänvisningen avser?', 'Textmönstret är endast en hänvisning. Motorn har inte kontrollerat att rätt PM är färdigt eller bifogat.', ['R10']);
      question(doc, /(?:bifoga(?:s|t|de)?|bilaga\s*\d|bifogad\s+inspelning)/gi, 'missing', 'är den angivna bilagan faktiskt tillgänglig?', 'En uppgift om bilaga visar inte att filen faktiskt finns eller har bifogats.', ['R10', 'R41']);

      if (['lob', 'pl13'].includes(doc.intervention) && (doc.type === 'interview' || doc.type === 'fritext' || /misstankeförhör|brottsanmälan|skäligen\s+misstänkt/i.test(text))) add(doc, 'legal', 'check', 'Kontrollfråga: finns en separat brottsmisstanke?', 'Valt ingripande (' + doc.intervention.toLocaleUpperCase('sv') + ') innebär inte i sig ett brott. Kontrollera om caset också ger en konkret brottsmisstanke och rätt dokumenttyp. PL 16-förhör och misstankeförhör är skilda.', ['R11', 'R23'], occurrence(text, /misstankeförhör|brottsanmälan|skäligen\s+misstänkt/i), 'Ange endast den brottsmisstanke och det förhör som faktiskt stöds av caset.');
      question(doc, /(?:offentlig\s+försvarare\s+(?:förordna\w*|utsågs)|förordna\w*\s+(?:en\s+)?offentlig\s+försvarare)/i, 'missing', 'är försvararens förordnande belagt?', 'Ett önskemål om försvarare eller ett direktiv är inte samma sak som ett faktiskt förordnande. Detta är en kontrollfråga, inte ett konstaterande om stöd i caset.', ['R46', 'R51']);
      question(doc, /(?:uppläst\s+och\s+godkänt|uppläst\s+och\s+godkänd|delgiv\w*\s+(?:sina\s+)?rättigheter|informer\w*\s+om\s+(?:sina\s+)?rättigheter|avst[åo]\w*\s+(?:från\s+)?försvarare)/i, 'missing', 'stöds den genomförda formaliteten?', 'Kontrollera att just denna åtgärd faktiskt har genomförts och dokumenterats. Motorn kan inte bekräfta det genom fri text i caset.', ['R05', 'R48', 'R51', 'R52']);
      question(doc, /(?:förenklad\s+delgivning|skriftlig\s+(?:rättighetsinformation|information\s+om\s+rättigheter))/i, 'legal', 'vilken information lämnades och när?', 'Kontrollera faktisk information, relevant skede och dokumentationsstöd. Olika informationsregler får inte ersättas av en generell standardfras.', ['R49', 'R53']);
      question(doc, /(?:finns|förekommer)\s+(?:med\s+)?i\s+(?:misstanke|belastnings)registret/i, 'legal', 'hålls registeruppgiften isär från en dom?', 'Mönstret visar en registerhänvisning, inte om personen är dömd eller vad uppgiften visar. Behåll källans precisering.', ['R04']);
      question(doc, /(?:fyndet|hittade|anträffade|påträffade)[^.!?\n]{0,100}(?:motiverade|grund\s+för|anledning\s+till)\s+(?:beslut|visitation|genomsökning)/i, 'legal', 'avser grunden det som var känt före beslutet?', 'Ett möjligt samband mellan fynd och beslutsgrund identifierades. Kontrollera beslutsunderlaget och tidsföljden manuellt; ett senare fynd får inte bli en tidigare beslutsgrund.', ['R30', 'R32', 'R43']);
      question(doc, /beslut\w*[^.!?\n]{0,60}(?:grundades|motiverades)[^.!?\n]{0,130}(?:hittades|anträffades|påträffades)[^.!?\n]{0,60}(?:efter|senare)/i, 'legal', 'används ett senare fynd som grund för det tidigare beslutet?', 'Formuleringen kan knyta beslutsgrunden till ett senare fynd. Kontrollera vad som var känt just när beslutet fattades. Motorn fastställer inte vad som faktiskt hände.', ['R30', 'R32', 'R43']);
      if (/(?:beslut\w*\s+om\s+förvar|förvarsbeslut)/i.test(text)) question(doc, /(?:beslut\w*\s+om\s+förvar|förvarsbeslut)[^\n]*/i, 'missing', 'är förvarsbeslut och insättning i cell särredovisade?', 'Beslut om förvar ger inte i sig en tid för faktisk insättning i cell. Kontrollera om insättning skedde och vilken tid som är belagd. Motorn flyttar eller fyller inte i någon tid.', ['R16', 'R43']);
      if (doc.type === 'interview') {
        if (!/\b(?:kl(?:ockan)?\.?\s*)?\d{1,2}[:.]\d{2}\b/.test(text)) add(doc, 'missing', 'check', 'Kontrollfråga: förhörets start- och sluttid', 'Ingen tydlig klocktid identifierades. Motorn kan inte bekräfta att förhörets båda tider finns i systemfälten.', ['R47'], null, 'Kontrollera start, slut och eventuell inspelning mot faktisk uppgift.');
        question(doc, /(?:mer\s+än|över)\s+sex\s+månader[^.!?\n]{0,80}(?:straffskala|straffet)|(?:FUK|förundersökningskungörelsen)\s*12\s*c/i, 'legal', 'är tillämpningsområdet för FUK 12 c rätt?', 'Kontrollera lagversion och den angivna strafftröskeln. Manualens regel gäller föreskrivet minimistraff, inte bara att straffskalans maximum överstiger sex månader.', ['R50']);
      }

      const oldForfeiture = occurrence(text, /(?:BrB\s*36\s*(?::\s*|kap\.?\s*)3(?!\d)(?:\s*§)?|36\s*kap\.?\s*3(?!\d)\s*§\s*(?:BrB|brottsbalken))/i);
      const wrongPoint = occurrence(text, /(?:BrB\s*36\s*(?::\s*|kap\.?\s*)12(?!\d)(?:\s*§)?\s*(?:[:.,]\s*2\b|p(?:unkt)?\.?\s*2\b|2\b(?:\s*p(?:unkten)?\.?)?|andra\s+punkten)|36\s*kap\.?\s*12(?!\d)\s*§\s*(?:andra\s+punkten|2\b(?:\s*p(?:unkten)?\.?)?))/i);
      if (oldForfeiture.quote) {
        const current = lawDate && lawDate >= '2024-11-08';
        add(doc, 'legal', 'check', current ? 'Kontrollfråga: äldre hänvisning till BrB 36:3' : 'Kontrollfråga: historisk hänvisning till BrB 36:3', current ? 'Valt lagdatum är efter reformen den 8 november 2024. För farliga föremål avser manualens nuvarande hänvisning BrB 36 kap. 12 § punkt 1. Äldre händelser och övergångsregler måste bedömas särskilt; hänvisningen ersätts inte automatiskt.' : 'BrB 36:3 är en äldre hänvisning. Den kan vara relevant för historiska händelser. Välj lagdatum och kontrollera tillämpliga övergångsbestämmelser.', ['R31'], oldForfeiture, 'Stäm av rätt lagversion och vilken förverkandegrund som avses.');
      }
      if (wrongPoint.quote && ['pl19', 'pl20a'].includes(doc.intervention) && (!lawDate || lawDate >= '2024-11-08')) add(doc, 'legal', 'check', 'Kontrollfråga: punkt i BrB 36:12', 'För farliga föremål som kan användas vid brott mot liv eller hälsa anger manualen punkt 1. Punkt 2 gäller en annan grund, skadegörelse. Kontrollera vilken grund caset faktiskt gäller; ingen automatisk ersättning görs.', ['R31'], wrongPoint);
      const oldWeapon = occurrence(text, /(?:vapenlagen\s*\(?1996\s*:\s*67\)?|1996\s*:\s*67)/i);
      if (oldWeapon.quote) add(doc, 'legal', 'check', lawDate && lawDate >= '2026-06-01' ? 'Kontrollfråga: äldre vapenlag vid valt lagdatum' : 'Kontrollfråga: vapenlagens tidsversion', lawDate && lawDate >= '2026-06-01' ? 'Valt lagdatum är den 1 juni 2026 eller senare. Manualen skiljer den äldre vapenlagen (1996:67) från vapenlagen (2026:408). Historiska gärningar kan kräva annan bedömning; inget lagrum ersätts automatiskt.' : 'Hänvisningen kan avse ett historiskt case. Tillämplig lag bestäms inte enbart av dagens datum. Kontrollera händelsedatum och lagversion.', ['R12', 'R31', 'R61'], oldWeapon);
      question(doc, /(?:1986\s*:\s*1009|(?:förverkande|anspråk)[^.!?\n]{0,80}en\s+månad)/i, 'legal', 'är blankettens laghänvisning och frist aktuella?', 'Äldre blanketttext kan ha annan hänvisning eller frist. Manualen beskriver en ändrad reglering; händelsedatum, ärendetyp och aktuell blankett måste kontrolleras.', ['R35']);
    }

    const facts = rawFacts.map((raw, index) => {
      raw = raw || {};
      const fact = Object.fromEntries(['source', 'key', 'subject', 'event', 'value', 'excerpt'].map(key => [key, bounded(raw[key], LIMITS.factText, 'Faktaraden').trim()]));
      fact.id = str(raw.id || 'fact-' + (index + 1));
      fact.key = TIME_ALIAS[fact.key] || fact.key;
      const sourceText = sourceTexts.get(fact.source);
      fact.verified = Boolean(fact.key && fact.value && fact.excerpt && typeof sourceText === 'string' && sourceText.includes(fact.excerpt) && hasWholeValue(fact.excerpt, fact.value));
      fact.verification = fact.verified ? 'Exakt citat med angivet värde finns i vald källa; sakinnebörden är inte verifierad.' : 'Obelagd faktarad: källa, exakt citat eller värdet i citatet saknas. Används inte som en säker motsägelse.';
      if (fact.source !== 'case' && sourceTexts.has(fact.source)) fact.documentId = fact.source;
      if (fact.verified) fact.locator = sourceText.indexOf(fact.excerpt);
      if (!fact.verified) {
        add(documents.find(doc => doc.id === fact.source), 'missing', 'check', 'Faktaraden saknar kontrollerbart källcitat', 'Faktaraden ”' + keyLabel(fact.key) + '” (' + sourceLabel(fact.source) + ') har inte ett exakt citat med angivet värde i vald källa. ' + fact.verification, ['R01', 'R02', 'R61'], { quote: fact.excerpt }, 'Kopiera ett exakt källcitat och kontrollera värde, roll och händelse.');
        complete('Belägg faktaraden ' + keyLabel(fact.key) + ' från ' + sourceLabel(fact.source) + ' med ett exakt källcitat.');
      }
      return fact;
    });
    const groups = new Map();
    for (const fact of facts) {
      const grouping = JSON.stringify([fact.key, fact.subject, fact.event]);
      if (!groups.has(grouping)) groups.set(grouping, []);
      groups.get(grouping).push(fact);
    }
    for (const group of groups.values()) {
      const verified = group.filter(fact => fact.verified);
      const values = uniq(verified.map(fact => canonical(fact.value)));
      const status = verified.length < 2 ? 'single' : values.length > 1 ? 'conflict' : 'same';
      const first = group[0];
      const entries = group.map(({ source, value, excerpt, verified, verification, documentId, locator }) => ({ source, value, excerpt, verified, verification, ...(documentId ? { documentId } : {}), ...(locator === undefined ? {} : { locator }) }));
      let explanation = status === 'conflict' ? 'Olika ordagranna värden för samma angivna uppgift, person/objekt och händelse. Kontrollera om raderna verkligen är jämförbara; motorn väljer ingen version.' : status === 'same' ? 'De belagda radernas textvärden överensstämmer. Detta bekräftar inte riktigheten eller att sammanhangen motsvarar varandra.' : 'Färre än två belagda rader i denna avgränsning. Ingen motsägelse eller överensstämmelse kan fastställas.';
      if (group.some(fact => !fact.verified)) explanation += ' Obelagda rader visas men avgör inte jämförelsens status.';
      comparisons.push({ key: first.key, subject: first.subject, event: first.event, entries, status, explanation });
      if (status === 'conflict') {
        add(null, 'contradiction', 'check', 'Kontrollfråga: olika värden för ' + keyLabel(first.key), explanation + ' Källor: ' + verified.map(fact => sourceLabel(fact.source) + ': ' + fact.value).join(' / '), ['R01', 'R02', 'R43', 'R44'], { quote: verified.map(fact => sourceLabel(fact.source) + ': ' + fact.excerpt).join('\n') }, 'Kontrollera källorna och rätta endast efter en uttrycklig bedömning.');
        complete('Utred skillnaden i ' + keyLabel(first.key) + (first.subject ? ' för ' + first.subject : '') + (first.event ? ' vid ' + first.event : '') + '.');
      }
    }

    function timedFact(fact) {
      const full = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(fact.value);
      if (full && dateValue(full[1]) && +full[2] < 24 && +full[3] < 60 && +(full[4] || 0) < 60) {
        const milliseconds = Date.parse(fact.value.replace(' ', 'T') + (full[5] ? '' : 'Z'));
        return Number.isFinite(milliseconds) ? { time: milliseconds, dated: true, zone: full[5] ? 'absolute' : 'local', date: full[1] } : null;
      }
      const time = /^(?:kl\.?\s*)?(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/.exec(fact.value);
      if (!time || +time[1] > 23 || +time[2] > 59 || +(time[3] || 0) > 59) return null;
      const dates = uniq(facts.filter(other => other.verified && other.source === fact.source && other.key === 'date' && other.subject === fact.subject && other.event === fact.event).map(other => dateValue(other.value)).filter(Boolean));
      if (dates.length !== 1) return null;
      return { time: Date.parse(dates[0] + 'T00:00:00Z') + (+time[1] * 3600 + +time[2] * 60 + +(time[3] || 0)) * 1000, dated: false, zone: 'local', date: dates[0] };
    }
    const timeContexts = new Map();
    for (const fact of facts.filter(f => f.verified && TIME_KEYS.has(f.key))) {
      const key = JSON.stringify([fact.source, fact.subject, fact.event]);
      if (!timeContexts.has(key)) timeContexts.set(key, []);
      timeContexts.get(key).push(fact);
    }
    for (const group of timeContexts.values()) {
      for (const [beforeKey, afterKey, label] of [['plDecisionTime', 'findingTime', 'PL-beslut och fynd'], ['custodyDecisionTime', 'cellEntryTime', 'förvarsbeslut och cellinsättning']]) {
        const before = group.filter(f => f.key === beforeKey), after = group.filter(f => f.key === afterKey);
        if (before.length !== 1 || after.length !== 1) continue;
        const a = timedFact(before[0]), b = timedFact(after[0]);
        if (!a || !b || a.zone !== b.zone || (!(a.dated && b.dated) && a.date !== b.date)) continue;
        if (a.time > b.time) add(documents.find(doc => doc.id === before[0].source), 'contradiction', 'check', 'Kontrollfråga: tidsföljd för ' + label, 'De belagda och daterade faktaraderna anger ' + before[0].value + ' respektive ' + after[0].value + '. Kontrollera om händelserna hör ihop och tidsuppgifterna avser rätt beslut eller åtgärd. Inga tider ändras och inget midnattsskifte antas.', ['R16', 'R30', 'R32', 'R43'], { quote: before[0].excerpt + '\n' + after[0].excerpt }, 'Stäm av datum, händelse och vilken åtgärd varje klockslag avser.');
      }
    }
    if (facts.length === 0) limitations.push('Inga strukturerade faktarader har lämnats. Personer, platser, antal och tider har inte jämförts semantiskt mellan fritexter.');
    return {
      scope: { originalProvided: Boolean(originalCase.trim()), limitations, referenceDate: referenceDate || '', lawDate: lawDate || '' },
      findings, proposals, comparisons, completions, derivedDrafts,
      summary: { checkedDocuments: documents.filter(doc => doc.text.trim()).length, findings: findings.length,
        proposedChanges: proposals.length, factRows: facts.length, verifiedFactRows: facts.filter(f => f.verified).length,
        conflicts: comparisons.filter(c => c.status === 'conflict').length, checks: findings.filter(f => f.severity === 'check').length, derivedDrafts: derivedDrafts.length,
        semanticVerification: false }
    };
  }

  function applyProposals(original, proposals, acceptedIds) {
    const text = bounded(original, LIMITS.text, 'Originaltext');
    const accepted = new Set(acceptedIds || []);
    const selected = (proposals || []).filter(p => accepted.has(p.id)).sort((a, b) => a.start - b.start);
    if (selected.length !== accepted.size) throw new Error('Ett valt förslag saknas eller har dubblerat id.');
    const selectedIds = new Set();
    let end = -1;
    for (const p of selected) {
      if (selectedIds.has(p.id) || !Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < 0 || p.end < p.start || p.end > text.length || p.start < end || typeof p.before !== 'string' || typeof p.after !== 'string' || text.slice(p.start, p.end) !== p.before) throw new Error('Förslagen överlappar eller stämmer inte längre med originalet. Granska originaltexten igen.');
      selectedIds.add(p.id); end = p.end;
    }
    let result = text;
    for (const p of selected.slice().reverse()) result = result.slice(0, p.start) + p.after + result.slice(p.end);
    if (result.length > LIMITS.text) throw new RangeError('Den ändrade texten är för lång.');
    return result;
  }

  function diffLines(before, after) {
    before = bounded(before, LIMITS.text, 'Originaltext');
    after = bounded(after, LIMITS.text, 'Ändrad text');
    const left = before.split('\n'), right = after.split('\n');
    if (before === after) return left.map(text => ({ type: 'same', text }));
    // Bounded LCS; large inputs retain exact content with a coarse middle block.
    let prefix = 0, suffix = 0;
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
    while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
    const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix);
    const result = left.slice(0, prefix).map(text => ({ type: 'same', text }));
    if (a.length * b.length > 250000) {
      result.push(...a.map(text => ({ type: 'removed', text })), ...b.map(text => ({ type: 'added', text })));
    } else {
      const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
      for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      let i = 0, j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ type: 'same', text: a[i++] }); j++; }
        else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) result.push({ type: 'removed', text: a[i++] });
        else result.push({ type: 'added', text: b[j++] });
      }
    }
    result.push(...left.slice(left.length - suffix).map(text => ({ type: 'same', text })));
    return result;
  }
  root.ReviewEngine = Object.freeze({ review, applyProposals, diffLines, limits: LIMITS });
})(typeof window === 'undefined' ? globalThis : window);
