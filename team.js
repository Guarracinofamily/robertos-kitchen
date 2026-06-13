// Get to Know Us — multilingual team survey + honest assessment (admin only sees scoring)
var TEAM_KEY = 'team';
var teamStaff = [];
var teamCurrent = null;
var teamAnswers = {};       // qid -> option key(s) for choices, raw text for text qs, number for scale
var teamSubmissions = [];
var teamMode = 'list';
var teamScrollY = 0;
var teamLang = 'en';        // current display language

// ── Survey round config (quarterly cycle) ──
// Update these each round. teamDeadline = when Danilo must have the team finished.
var TEAM_ROUND = {
  label: 'Round 1 · June 2026',
  deadline: '2026-06-20',     // team must complete by this date
  nextTest: '2026-09-30'      // next quarterly test
};

var TEAM_STATION_LABEL = {
  'management':'Management','pass':'Management','raw_bar':'Crudo','pasta':'Pasta',
  'main':'Main Course','pastry_pizza':'Pastry & Pizza','stewarding':'Stewarding','other':'Team'
};
var TEAM_SECTIONS = [
  { key:'management', label:'Management', stations:['management','pass'] },
  { key:'raw_bar',    label:'Crudo',          stations:['raw_bar'] },
  { key:'pasta',      label:'Pasta',          stations:['pasta'] },
  { key:'main',       label:'Main Course',    stations:['main'] },
  { key:'pastry_pizza', label:'Pastry & Pizza', stations:['pastry_pizza'] },
  { key:'stewarding', label:'Stewarding',     stations:['stewarding'] },
  { key:'other',      label:'Team',           stations:['other'] }
];
function teamSectionFor(stationKey){
  var k = stationKey || 'other';
  for (var i=0;i<TEAM_SECTIONS.length;i++){ if (TEAM_SECTIONS[i].stations.indexOf(k)!==-1) return TEAM_SECTIONS[i]; }
  return TEAM_SECTIONS[TEAM_SECTIONS.length-1];
}
// ── Question set: stable keys, multi-language. Scoring reads option KEYS, never display text. ──
// Each option: { k:'a', score:{dim:val} }. Display text lives in TEAM_I18N[lang].
var TEAM_QUESTIONS = [
  { id:'motivate', type:'multi', max:2,
    opts:[{k:'a'},{k:'b',score:{loy:1}},{k:'c',score:{flight:0.5}},{k:'d',score:{eng:0.5}},{k:'e',score:{eng:1}},{k:'f'}] },
  { id:'drains', type:'multi', max:2,
    opts:[{k:'a'},{k:'b',score:{concern:0.5}},{k:'c',score:{concern:1}},{k:'d',score:{concern:1,flight:0.5}},{k:'e',score:{concern:1}},{k:'f',score:{concern:0.5}}] },
  { id:'annoys', type:'single',
    opts:[{k:'a'},{k:'b',score:{int:1}},{k:'c',score:{loy:0.5}},{k:'d',score:{rel:0.5}}] },
  { id:'lead', type:'single',
    opts:[{k:'a'},{k:'b'},{k:'c'},{k:'d'}] },
  { id:'priority_change', type:'single',
    opts:[{k:'a',score:{rel:1}},{k:'b',score:{rel:0.5}},{k:'c',score:{rel:-0.3,concern:0.3}},{k:'d',score:{rel:-0.6,concern:0.5}}] },
  { id:'trust', type:'single',
    opts:[{k:'a',score:{int:1}},{k:'b',score:{int:0.4}},{k:'c',score:{int:-0.3}},{k:'d',score:{int:-1}}] },
  { id:'pressure', type:'scale', low:true, high:true, score:{ dim:'rel', map:{1:-1,2:-0.5,3:0,4:0.5,5:1} } },
  { id:'promise', type:'single',
    opts:[{k:'a',score:{rel:1}},{k:'b',score:{rel:0}},{k:'c',score:{rel:-0.5}},{k:'d',score:{rel:-1}}] },
  { id:'protect', type:'single',
    opts:[{k:'a',score:{loy:1}},{k:'b',score:{loy:0.2}},{k:'c',score:{loy:-1}},{k:'d',score:{loy:0}}] },
  { id:'autonomy', type:'single',
    opts:[{k:'a',score:{rel:0}},{k:'b',score:{rel:0.3}},{k:'c',score:{rel:0.6}},{k:'d',score:{rel:0.8}}] },
  { id:'team_mood', type:'single',
    opts:[{k:'a',score:{eng:1}},{k:'b',score:{eng:0.2}},{k:'c',score:{eng:-0.7,concern:0.7}},{k:'d',score:{eng:-1,flight:1,concern:0.5}}] },
  { id:'fairness', type:'single',
    opts:[{k:'a',score:{loy:0.5}},{k:'b'},{k:'c'},{k:'d',score:{concern:0.7,loy:-0.3}}] },
  { id:'next_year', type:'single',
    opts:[{k:'a',score:{loy:1,flight:-0.5}},{k:'b',score:{loy:0.5,eng:0.5}},{k:'c',score:{flight:1.5,loy:-0.5}},{k:'d',score:{flight:0.7}}] },
  { id:'stay', type:'multi', max:2,
    opts:[{k:'a',score:{loy:0.3}},{k:'b',score:{flight:0.3}},{k:'c',score:{loy:0.5}},{k:'d',score:{eng:0.5}},{k:'e',score:{eng:0.4}},{k:'f'}] },
  { id:'energy', type:'single',
    opts:[{k:'a',score:{eng:0.7}},{k:'b',score:{eng:0.3}},{k:'c',score:{eng:-0.7,concern:0.5}},{k:'d'}] },
  { id:'rules', type:'single',
    opts:[{k:'a',score:{int:1}},{k:'b',score:{int:0.4}},{k:'c',score:{int:-0.3}},{k:'d',score:{int:-1}}] },
  { id:'remember', type:'single',
    opts:[{k:'a',score:{rel:0.5}},{k:'b',score:{rel:0.8}},{k:'c',score:{rel:0.3}},{k:'d',score:{rel:-0.5}}] },
  { id:'change_one', type:'text' },
  { id:'anything', type:'text', optional:true }
];

// Cross-check pairs: when answers contradict, raise a soft flag AND soften the dimension.
var TEAM_CROSSCHECKS = [
  { id:'flight', a:'team_mood', b:'next_year',
    contradiction:function(ans){
      var settled = (ans.team_mood==='a');           // says team happy here
      var leaving = (ans.next_year==='c');            // but plans to go elsewhere
      return settled && leaving;
    },
    dim:'loyalty', note:'Says the team is happy here, but plans to leave — answers do not line up.' },
  { id:'integrity', a:'annoys', b:'trust',
    contradiction:function(ans){
      // Hates liars most (values honesty) BUT believes almost nobody can be trusted
      return ans.annoys==='b' && ans.trust==='d';
    },
    dim:'integrity', note:'Says they hate dishonesty most, yet trusts almost no one — worth a closer read.' }
];
// ── UI strings + all question text per language. Keys map to TEAM_QUESTIONS option keys. ──
var TEAM_LANGS = [
  { code:'en', label:'English' },
  { code:'hi', label:'हिन्दी (Hindi)' },
  { code:'ne', label:'नेपाली (Nepali)' },
  { code:'it', label:'Italiano' },
  { code:'tl', label:'Tagalog' }
];

var TEAM_I18N = {
  en: {
    ui:{ title:'Get to Know Us',
      intro:'Help me understand the team better. Pick your language, then your name, answer a few quick questions, and tap send. About 5 minutes. There are no wrong answers — just be honest.',
      pickLang:'Choose your language', notMe:'Not me', send:'Send', sending:'Sending…',
      answerAll:'Please answer the highlighted question', of:'of', answered:'answered',
      thanks:'Grazie', thanksMsg:'Your answers are saved. Thank you for being honest — it really helps.', done:'Done',
      passPrompt:'Enter your Employee ID to start', passPromptCode:'Enter your passcode to start',
      passWrong:'That does not match. Please check and try again.',
      confirmNoId:'We do not have an ID for you. Tap OK to confirm this is you and start.',
      scaleLow:'I find it very hard', scaleHigh:'I work even better' },
    q:{
      motivate:{ q:'What gives you energy at work? (pick up to 2)', o:{a:'People say I did well',b:'Being part of a team',c:'Money and a stable job',d:'Learning new things',e:'Doing the work to a high standard',f:'Freedom to do it my way'} },
      drains:{ q:'What makes your job hard or upsets you? (pick up to 2)', o:{a:'The plan changes too many times',b:'Too much work, not enough people',c:'Nobody listens to me',d:'People promise things but don\u2019t do them',e:'Someone shouts at me or is rude',f:'I don\u2019t know what I should do'} },
      annoys:{ q:'What do you not like when someone works with you?', o:{a:'They are lazy',b:'They lie or make excuses',c:'They say my work is theirs',d:'They waste food or things'} },
      lead:{ q:'How do you like your leader to work with you?', o:{a:'Tell me exactly what to do',b:'Tell me the goal, I find the way',c:'Check on me often',d:'Leave me alone unless I need help'} },
      priority_change:{ q:'The plan changes fast during your shift. How do you feel?', o:{a:'No problem, I change fast',b:'Not happy, but I do it',c:'I feel stressed, I need a minute',d:'It makes my day very hard'} },
      trust:{ q:'How many people can you really trust?', o:{a:'Almost everyone, most people are good',b:'Many people',c:'Only a few',d:'Almost nobody, people lie a lot'} },
      pressure:{ q:'When the kitchen is very busy and short of people, how do you work?' },
      promise:{ q:'Someone says they will do something, but they don\u2019t. Why?', o:{a:'Something real stopped them',b:'They forgot',c:'They did not really care',d:'Everyone does this, it is normal'} },
      protect:{ q:'When there is a problem at work, most people protect\u2026', o:{a:'The team',b:'Their close friends only',c:'Themselves first',d:'The leader'} },
      autonomy:{ q:'You need to decide something and the leader is not there. What do you do?', o:{a:'I wait and ask first',b:'I ask a senior near me',c:'I decide the small things myself',d:'I decide myself, I am sure'} },
      team_mood:{ q:'Most people in this kitchen feel\u2026', o:{a:'Happy to be here',b:'Okay, it is a job',c:'Tired and stressed',d:'Like they want to leave'} },
      fairness:{ q:'Two people do the same work. One gets praised more. The other should\u2026', o:{a:'Be happy for him',b:'Say nothing, keep working',c:'Feel it is not fair',d:'Work less next time'} },
      next_year:{ q:'Where do you see yourself in one year?', o:{a:'Here, growing in this team',b:'Here, but doing more',c:'In a new place',d:'I don\u2019t know yet'} },
      stay:{ q:'What makes you want to stay in a job? (pick 2)', o:{a:'People respect me',b:'Good money',c:'A team I trust',d:'Chance to learn and grow',e:'My work means something',f:'A calm place, no stress'} },
      energy:{ q:'At the end of a normal shift, how do you feel?', o:{a:'Still strong',b:'Tired but happy',c:'Very tired',d:'Some days good, some days tired'} },
      rules:{ q:'What do you think about rules at work?', o:{a:'Rules keep everyone safe and fair',b:'Rules are mostly good',c:'Some rules waste time',d:'Rules are made to be broken'} },
      remember:{ q:'You have many small things to remember in one day. What is true for you?', o:{a:'I remember everything',b:'I write things down so I never forget',c:'I remember only the important things',d:'Sometimes I forget small things'} },
      change_one:{ q:'If you could change ONE thing here to make your work better, what would it be?', ph:'Write freely, in any language you like.' },
      anything:{ q:'Anything else you want me to know? (optional)', ph:'Optional — leave blank if nothing. Any language is fine.' }
    }
  },
  it: {
    ui:{ title:'Conosciamoci Meglio',
      intro:'Aiutami a conoscere meglio il team. Scegli la lingua, poi il tuo nome, rispondi a poche domande veloci e premi invia. Circa 5 minuti. Non ci sono risposte sbagliate — sii sincero.',
      pickLang:'Scegli la tua lingua', notMe:'Non sono io', send:'Invia', sending:'Invio…',
      answerAll:'Rispondi alla domanda evidenziata', of:'di', answered:'risposte',
      thanks:'Grazie', thanksMsg:'Le tue risposte sono salvate. Grazie per la sincerità — aiuta davvero.', done:'Fatto',
      passPrompt:'Inserisci il tuo ID dipendente per iniziare', passPromptCode:'Inserisci il tuo codice per iniziare',
      passWrong:'Non corrisponde. Controlla e riprova.',
      confirmNoId:'Non abbiamo un ID per te. Tocca OK per confermare che sei tu e iniziare.',
      scaleLow:'Lo trovo molto difficile', scaleHigh:'Lavoro ancora meglio' },
    q:{
      motivate:{ q:'Cosa ti dà energia al lavoro? (scegli fino a 2)', o:{a:'Quando dicono che ho fatto bene',b:'Far parte di una squadra',c:'Soldi e un lavoro stabile',d:'Imparare cose nuove',e:'Fare il lavoro a un alto livello',f:'Libertà di farlo a modo mio'} },
      drains:{ q:'Cosa rende difficile il tuo lavoro o ti disturba? (scegli fino a 2)', o:{a:'Il piano cambia troppe volte',b:'Troppo lavoro, poche persone',c:'Nessuno mi ascolta',d:'Promettono ma non mantengono',e:'Qualcuno mi urla contro o è scortese',f:'Non so cosa devo fare'} },
      annoys:{ q:'Cosa non ti piace quando qualcuno lavora con te?', o:{a:'È pigro',b:'Mente o trova scuse',c:'Dice che il mio lavoro è suo',d:'Spreca cibo o cose'} },
      lead:{ q:'Come vuoi che il tuo responsabile lavori con te?', o:{a:'Dimmi esattamente cosa fare',b:'Dimmi l\u2019obiettivo, trovo io il modo',c:'Controllami spesso',d:'Lasciami in pace se non chiedo aiuto'} },
      priority_change:{ q:'Il piano cambia in fretta durante il turno. Come ti senti?', o:{a:'Nessun problema, cambio veloce',b:'Non contento, ma lo faccio',c:'Mi sento stressato, mi serve un minuto',d:'Mi rende la giornata molto dura'} },
      trust:{ q:'Di quante persone ti puoi davvero fidare?', o:{a:'Quasi tutti, la gente è buona',b:'Molte persone',c:'Solo poche',d:'Quasi nessuno, la gente mente molto'} },
      pressure:{ q:'Quando la cucina è molto piena e manca personale, come lavori?' },
      promise:{ q:'Qualcuno dice che farà una cosa, ma non la fa. Perché?', o:{a:'Qualcosa di vero glielo ha impedito',b:'Ha dimenticato',c:'Non gli importava davvero',d:'Lo fanno tutti, è normale'} },
      protect:{ q:'Quando c\u2019è un problema al lavoro, la maggior parte protegge\u2026', o:{a:'La squadra',b:'Solo i loro amici stretti',c:'Prima se stessi',d:'Il responsabile'} },
      autonomy:{ q:'Devi decidere qualcosa e il responsabile non c\u2019è. Cosa fai?', o:{a:'Aspetto e chiedo prima',b:'Chiedo a un senior vicino',c:'Decido io le piccole cose',d:'Decido io, sono sicuro'} },
      team_mood:{ q:'La maggior parte delle persone in questa cucina si sente\u2026', o:{a:'Felice di essere qui',b:'Va bene, è un lavoro',c:'Stanca e stressata',d:'Come se volesse andarsene'} },
      fairness:{ q:'Due persone fanno lo stesso lavoro. Una viene lodata di più. L\u2019altra dovrebbe\u2026', o:{a:'Essere felice per lui',b:'Non dire niente, continuare a lavorare',c:'Sentire che non è giusto',d:'Lavorare meno la prossima volta'} },
      next_year:{ q:'Dove ti vedi tra un anno?', o:{a:'Qui, a crescere in questa squadra',b:'Qui, ma facendo di più',c:'In un posto nuovo',d:'Non lo so ancora'} },
      stay:{ q:'Cosa ti fa voler restare in un lavoro? (scegli 2)', o:{a:'Le persone mi rispettano',b:'Buoni soldi',c:'Una squadra di cui mi fido',d:'Possibilità di imparare e crescere',e:'Il mio lavoro conta qualcosa',f:'Un posto tranquillo, senza stress'} },
      energy:{ q:'Alla fine di un turno normale, come ti senti?', o:{a:'Ancora forte',b:'Stanco ma contento',c:'Molto stanco',d:'Certi giorni bene, certi stanco'} },
      rules:{ q:'Cosa pensi delle regole al lavoro?', o:{a:'Le regole tengono tutti al sicuro e giusti',b:'Le regole sono per lo più buone',c:'Alcune regole fanno perdere tempo',d:'Le regole sono fatte per essere infrante'} },
      remember:{ q:'Hai molte piccole cose da ricordare in un giorno. Cosa è vero per te?', o:{a:'Ricordo tutto',b:'Scrivo le cose per non dimenticare mai',c:'Ricordo solo le cose importanti',d:'A volte dimentico le piccole cose'} },
      change_one:{ q:'Se potessi cambiare UNA cosa qui per migliorare il tuo lavoro, quale sarebbe?', ph:'Scrivi liberamente, nella lingua che preferisci.' },
      anything:{ q:'Qualcos\u2019altro che vuoi dirmi? (facoltativo)', ph:'Facoltativo — lascia vuoto se niente. Va bene qualsiasi lingua.' }
    }
  },
  hi: {
    ui:{ title:'हमें जानिए',
      intro:'टीम को बेहतर समझने में मेरी मदद करें। अपनी भाषा चुनें, फिर अपना नाम, कुछ छोटे सवालों के जवाब दें और भेजें दबाएँ। लगभग 5 मिनट। कोई गलत जवाब नहीं है — बस सच बताएँ।',
      pickLang:'अपनी भाषा चुनें', notMe:'मैं नहीं', send:'भेजें', sending:'भेज रहे हैं…',
      answerAll:'कृपया हाइलाइट किए गए सवाल का जवाब दें', of:'में से', answered:'उत्तर दिए',
      thanks:'धन्यवाद', thanksMsg:'आपके जवाब सेव हो गए हैं। सच बताने के लिए धन्यवाद — इससे बहुत मदद मिलती है।', done:'पूरा',
      passPrompt:'शुरू करने के लिए अपना कर्मचारी ID डालें', passPromptCode:'शुरू करने के लिए अपना पासकोड डालें',
      passWrong:'यह मेल नहीं खाता। कृपया जाँचें और फिर कोशिश करें।',
      confirmNoId:'हमारे पास आपका ID नहीं है। यह आप हैं इसकी पुष्टि के लिए OK दबाएँ और शुरू करें।',
      scaleLow:'मुझे यह बहुत मुश्किल लगता है', scaleHigh:'मैं और भी अच्छा काम करता हूँ' },
    q:{
      motivate:{ q:'काम में आपको ऊर्जा क्या देता है? (2 तक चुनें)', o:{a:'लोग कहें कि मैंने अच्छा किया',b:'टीम का हिस्सा होना',c:'पैसा और स्थिर नौकरी',d:'नई चीज़ें सीखना',e:'काम को ऊँचे स्तर पर करना',f:'अपने तरीके से करने की आज़ादी'} },
      drains:{ q:'आपका काम कठिन या परेशान क्या करता है? (2 तक चुनें)', o:{a:'योजना बहुत बार बदलती है',b:'बहुत काम, कम लोग',c:'कोई मेरी नहीं सुनता',d:'लोग वादा करते हैं पर नहीं करते',e:'कोई मुझ पर चिल्लाता या बदतमीज़ी करता है',f:'मुझे नहीं पता मुझे क्या करना है'} },
      annoys:{ q:'जब कोई आपके साथ काम करता है तो आपको क्या पसंद नहीं?', o:{a:'वह आलसी है',b:'वह झूठ बोलता या बहाने बनाता है',c:'वह कहता है मेरा काम उसका है',d:'वह खाना या चीज़ें बर्बाद करता है'} },
      lead:{ q:'आप चाहते हैं आपका लीडर आपके साथ कैसे काम करे?', o:{a:'मुझे ठीक-ठीक बताएँ क्या करना है',b:'लक्ष्य बताएँ, रास्ता मैं ढूँढ लूँगा',c:'मुझ पर बार-बार ध्यान दें',d:'जब तक मैं मदद न माँगूँ, मुझे छोड़ दें'} },
      priority_change:{ q:'शिफ्ट के दौरान योजना तेज़ी से बदलती है। आप कैसा महसूस करते हैं?', o:{a:'कोई बात नहीं, मैं जल्दी बदल लेता हूँ',b:'खुश नहीं, पर कर लेता हूँ',c:'मुझे तनाव होता है, एक मिनट चाहिए',d:'मेरा दिन बहुत मुश्किल हो जाता है'} },
      trust:{ q:'आप सच में कितने लोगों पर भरोसा कर सकते हैं?', o:{a:'लगभग सब पर, ज़्यादातर लोग अच्छे हैं',b:'कई लोगों पर',c:'सिर्फ़ कुछ पर',d:'लगभग किसी पर नहीं, लोग बहुत झूठ बोलते हैं'} },
      pressure:{ q:'जब रसोई बहुत व्यस्त हो और लोग कम हों, तो आप कैसे काम करते हैं?' },
      promise:{ q:'कोई कहता है कि वह कुछ करेगा, पर नहीं करता। क्यों?', o:{a:'कोई सच्ची वजह ने रोक दिया',b:'वह भूल गया',c:'उसे सच में परवाह नहीं थी',d:'सब ऐसा करते हैं, यह आम बात है'} },
      protect:{ q:'जब काम में समस्या होती है, तो ज़्यादातर लोग किसे बचाते हैं\u2026', o:{a:'टीम को',b:'सिर्फ़ अपने करीबी दोस्तों को',c:'पहले खुद को',d:'लीडर को'} },
      autonomy:{ q:'आपको कुछ तय करना है और लीडर वहाँ नहीं है। आप क्या करते हैं?', o:{a:'मैं रुकता हूँ और पहले पूछता हूँ',b:'पास के किसी सीनियर से पूछता हूँ',c:'छोटी बातें खुद तय करता हूँ',d:'मैं खुद तय करता हूँ, मुझे यकीन है'} },
      team_mood:{ q:'इस रसोई में ज़्यादातर लोग महसूस करते हैं\u2026', o:{a:'यहाँ होकर खुश',b:'ठीक है, नौकरी है',c:'थके और तनाव में',d:'जैसे वे जाना चाहते हैं'} },
      fairness:{ q:'दो लोग एक ही काम करते हैं। एक की ज़्यादा तारीफ़ होती है। दूसरे को\u2026', o:{a:'उसके लिए खुश होना चाहिए',b:'कुछ न कहे, काम करता रहे',c:'लगे कि यह ठीक नहीं',d:'अगली बार कम काम करे'} },
      next_year:{ q:'एक साल बाद आप खुद को कहाँ देखते हैं?', o:{a:'यहीं, इस टीम में आगे बढ़ते हुए',b:'यहीं, पर ज़्यादा करते हुए',c:'किसी नई जगह',d:'अभी पता नहीं'} },
      stay:{ q:'किस वजह से आप नौकरी में रुकना चाहते हैं? (2 चुनें)', o:{a:'लोग मेरी इज़्ज़त करते हैं',b:'अच्छा पैसा',c:'जिस टीम पर भरोसा है',d:'सीखने और बढ़ने का मौका',e:'मेरे काम का मतलब है',f:'शांत जगह, कोई तनाव नहीं'} },
      energy:{ q:'सामान्य शिफ्ट के अंत में आप कैसा महसूस करते हैं?', o:{a:'अब भी मज़बूत',b:'थका पर खुश',c:'बहुत थका',d:'कुछ दिन अच्छे, कुछ दिन थके'} },
      rules:{ q:'काम के नियमों के बारे में आप क्या सोचते हैं?', o:{a:'नियम सबको सुरक्षित और निष्पक्ष रखते हैं',b:'नियम ज़्यादातर अच्छे हैं',c:'कुछ नियम समय बर्बाद करते हैं',d:'नियम तोड़ने के लिए बने हैं'} },
      remember:{ q:'एक दिन में आपको कई छोटी बातें याद रखनी होती हैं। आपके लिए क्या सच है?', o:{a:'मुझे सब याद रहता है',b:'मैं लिख लेता हूँ ताकि कभी न भूलूँ',c:'सिर्फ़ ज़रूरी बातें याद रखता हूँ',d:'कभी-कभी छोटी बातें भूल जाता हूँ'} },
      change_one:{ q:'अगर आप यहाँ एक चीज़ बदल सकें जिससे आपका काम बेहतर हो, तो वह क्या होगी?', ph:'खुलकर लिखें, जिस भाषा में चाहें।' },
      anything:{ q:'कुछ और जो आप मुझे बताना चाहते हैं? (वैकल्पिक)', ph:'वैकल्पिक — कुछ नहीं तो खाली छोड़ें। कोई भी भाषा ठीक है।' }
    }
  },
  ne: {
    ui:{ title:'हामीलाई चिन्नुहोस्',
      intro:'टोलीलाई राम्ररी बुझ्न मलाई मद्दत गर्नुहोस्। आफ्नो भाषा छान्नुहोस्, त्यसपछि आफ्नो नाम, केही छोटा प्रश्नको जवाफ दिनुहोस् र पठाउनुहोस् थिच्नुहोस्। लगभग ५ मिनेट। कुनै गलत जवाफ छैन — साँचो भन्नुहोस्।',
      pickLang:'आफ्नो भाषा छान्नुहोस्', notMe:'म होइन', send:'पठाउनुहोस्', sending:'पठाउँदै…',
      answerAll:'कृपया हाइलाइट गरिएको प्रश्नको जवाफ दिनुहोस्', of:'मध्ये', answered:'जवाफ दिइयो',
      thanks:'धन्यवाद', thanksMsg:'तपाईंका जवाफ सुरक्षित भए। साँचो भनिदिनुभएकोमा धन्यवाद — यसले धेरै मद्दत गर्छ।', done:'भयो',
      passPrompt:'सुरु गर्न आफ्नो कर्मचारी ID हाल्नुहोस्', passPromptCode:'सुरु गर्न आफ्नो पासकोड हाल्नुहोस्',
      passWrong:'यो मिलेन। कृपया जाँच गरेर फेरि प्रयास गर्नुहोस्।',
      confirmNoId:'हामीसँग तपाईंको ID छैन। यो तपाईं नै हो भनी पुष्टि गर्न OK थिच्नुहोस् र सुरु गर्नुहोस्।',
      scaleLow:'मलाई धेरै गाह्रो लाग्छ', scaleHigh:'म झन् राम्रो काम गर्छु' },
    q:{
      motivate:{ q:'काममा तपाईंलाई ऊर्जा के दिन्छ? (२ सम्म छान्नुहोस्)', o:{a:'मैले राम्रो गरें भनेर मानिसहरूले भन्दा',b:'टोलीको हिस्सा हुनु',c:'पैसा र स्थिर जागिर',d:'नयाँ कुरा सिक्नु',e:'काम उच्च स्तरमा गर्नु',f:'आफ्नै तरिकाले गर्ने स्वतन्त्रता'} },
      drains:{ q:'तपाईंको काम कठिन वा दिक्क के बनाउँछ? (२ सम्म छान्नुहोस्)', o:{a:'योजना धेरै पटक बदलिन्छ',b:'धेरै काम, थोरै मानिस',c:'कसैले मेरो कुरा सुन्दैन',d:'मानिसहरू वाचा गर्छन् तर गर्दैनन्',e:'कसैले मलाई कराउँछ वा रुखो गर्छ',f:'मलाई के गर्नुपर्छ थाहा छैन'} },
      annoys:{ q:'कसैले तपाईंसँग काम गर्दा के मन पर्दैन?', o:{a:'ऊ अल्छी छ',b:'ऊ झूट बोल्छ वा बहाना बनाउँछ',c:'ऊ मेरो काम आफ्नो हो भन्छ',d:'ऊ खाना वा सामान खेर फाल्छ'} },
      lead:{ q:'तपाईंको लिडरले तपाईंसँग कसरी काम गरेको चाहनुहुन्छ?', o:{a:'मलाई ठ्याक्कै के गर्ने भन्नुहोस्',b:'लक्ष्य भन्नुहोस्, बाटो म खोज्छु',c:'मलाई बारम्बार हेर्नुहोस्',d:'मैले मद्दत नमागेसम्म मलाई छाड्नुहोस्'} },
      priority_change:{ q:'शिफ्टमा योजना छिटो बदलिन्छ। तपाईंलाई कस्तो लाग्छ?', o:{a:'समस्या छैन, म छिटो बदल्छु',b:'खुसी छैन, तर गर्छु',c:'मलाई तनाव हुन्छ, एक मिनेट चाहिन्छ',d:'मेरो दिन धेरै गाह्रो हुन्छ'} },
      trust:{ q:'तपाईं साँच्चै कति मानिसलाई विश्वास गर्न सक्नुहुन्छ?', o:{a:'लगभग सबैलाई, धेरैजसो मानिस राम्रा छन्',b:'धेरै मानिसलाई',c:'केहीलाई मात्र',d:'लगभग कसैलाई पनि होइन, मानिस धेरै झूट बोल्छन्'} },
      pressure:{ q:'भान्सा धेरै व्यस्त र मानिस कम हुँदा तपाईं कसरी काम गर्नुहुन्छ?' },
      promise:{ q:'कसैले केही गर्छु भन्छ, तर गर्दैन। किन?', o:{a:'साँचो कारणले रोक्यो',b:'उसले बिर्सियो',c:'उसलाई साँच्चै वास्ता थिएन',d:'सबैले यसो गर्छन्, यो सामान्य हो'} },
      protect:{ q:'काममा समस्या हुँदा, धेरैजसो मानिस कसलाई जोगाउँछन्\u2026', o:{a:'टोलीलाई',b:'आफ्ना नजिकका साथीलाई मात्र',c:'पहिले आफूलाई',d:'लिडरलाई'} },
      autonomy:{ q:'तपाईंले केही निर्णय गर्नुपर्छ र लिडर त्यहाँ छैन। तपाईं के गर्नुहुन्छ?', o:{a:'म पर्खन्छु र पहिले सोध्छु',b:'नजिकको सिनियरलाई सोध्छु',c:'साना कुरा आफैं निर्णय गर्छु',d:'म आफैं निर्णय गर्छु, मलाई यकिन छ'} },
      team_mood:{ q:'यो भान्सामा धेरैजसो मानिस महसुस गर्छन्\u2026', o:{a:'यहाँ भएर खुसी',b:'ठीक छ, जागिर हो',c:'थकित र तनावमा',d:'जान चाहेजस्तो'} },
      fairness:{ q:'दुई जना उही काम गर्छन्। एक जनाको बढी प्रशंसा हुन्छ। अर्कोले\u2026', o:{a:'उसको लागि खुसी हुनुपर्छ',b:'केही नभनी काम गरिरहनुपर्छ',c:'यो ठीक छैन भन्ने महसुस गर्नुपर्छ',d:'अर्को पटक कम काम गर्नुपर्छ'} },
      next_year:{ q:'एक वर्षपछि तपाईं आफूलाई कहाँ देख्नुहुन्छ?', o:{a:'यहीं, यो टोलीमा बढ्दै',b:'यहीं, तर बढी गर्दै',c:'नयाँ ठाउँमा',d:'अहिले थाहा छैन'} },
      stay:{ q:'कुन कुराले तपाईंलाई जागिरमा रहन मन लगाउँछ? (२ छान्नुहोस्)', o:{a:'मानिसहरूले मलाई सम्मान गर्छन्',b:'राम्रो पैसा',c:'विश्वास गर्ने टोली',d:'सिक्ने र बढ्ने मौका',e:'मेरो कामको अर्थ छ',f:'शान्त ठाउँ, तनाव छैन'} },
      energy:{ q:'सामान्य शिफ्टको अन्त्यमा तपाईंलाई कस्तो लाग्छ?', o:{a:'अझै बलियो',b:'थकित तर खुसी',c:'धेरै थकित',d:'कुनै दिन राम्रो, कुनै दिन थकित'} },
      rules:{ q:'काममा नियमबारे तपाईं के सोच्नुहुन्छ?', o:{a:'नियमले सबैलाई सुरक्षित र निष्पक्ष राख्छ',b:'नियम धेरैजसो राम्रा छन्',c:'केही नियमले समय खेर फाल्छ',d:'नियम तोड्नकै लागि बनेका हुन्'} },
      remember:{ q:'एक दिनमा तपाईंले धेरै साना कुरा सम्झनुपर्छ। तपाईंको लागि के सही हो?', o:{a:'मलाई सबै सम्झना हुन्छ',b:'म लेख्छु ताकि कहिल्यै नबिर्सूँ',c:'महत्त्वपूर्ण कुरा मात्र सम्झन्छु',d:'कहिलेकाहीं साना कुरा बिर्सन्छु'} },
      change_one:{ q:'तपाईंले यहाँ एउटा कुरा बदल्न सक्नुभयो भने जसले तपाईंको काम राम्रो बनाओस्, त्यो के हुन्थ्यो?', ph:'खुलेर लेख्नुहोस्, जुन भाषामा मन लाग्छ।' },
      anything:{ q:'अरू केही जो तपाईं मलाई भन्न चाहनुहुन्छ? (वैकल्पिक)', ph:'वैकल्पिक — केही छैन भने खाली छाड्नुहोस्। जुनसुकै भाषा ठीक छ।' }
    }
  },
  tl: {
    ui:{ title:'Kilalanin Mo Kami',
      intro:'Tulungan mo akong mas makilala ang team. Piliin ang iyong wika, tapos ang pangalan mo, sagutin ang ilang mabilis na tanong, at pindutin ang send. Mga 5 minuto. Walang maling sagot — maging tapat lang.',
      pickLang:'Piliin ang iyong wika', notMe:'Hindi ako', send:'Ipadala', sending:'Ipinapadala…',
      answerAll:'Pakisagot ang naka-highlight na tanong', of:'sa', answered:'nasagot',
      thanks:'Salamat', thanksMsg:'Naka-save na ang iyong mga sagot. Salamat sa pagiging tapat — malaking tulong ito.', done:'Tapos',
      passPrompt:'Ilagay ang iyong Employee ID para magsimula', passPromptCode:'Ilagay ang iyong passcode para magsimula',
      passWrong:'Hindi tugma. Pakisuri at subukan ulit.',
      confirmNoId:'Wala kaming ID mo. Pindutin ang OK para kumpirmahing ikaw ito at magsimula.',
      scaleLow:'Mahirap ito para sa akin', scaleHigh:'Mas mahusay akong magtrabaho' },
    q:{
      motivate:{ q:'Ano ang nagbibigay sa iyo ng lakas sa trabaho? (pumili hanggang 2)', o:{a:'Sinasabi nilang magaling ako',b:'Pagiging bahagi ng team',c:'Pera at matatag na trabaho',d:'Matuto ng bagong bagay',e:'Gawin ang trabaho nang maayos',f:'Kalayaang gawin ito sa sarili kong paraan'} },
      drains:{ q:'Ano ang nagpapahirap o nakakainis sa trabaho mo? (pumili hanggang 2)', o:{a:'Madalas magbago ang plano',b:'Sobrang dami ng trabaho, kulang sa tao',c:'Walang nakikinig sa akin',d:'Nangangako pero hindi tinutupad',e:'May sumisigaw o bastos sa akin',f:'Hindi ko alam ang dapat kong gawin'} },
      annoys:{ q:'Ano ang ayaw mo kapag may katrabaho ka?', o:{a:'Tamad siya',b:'Nagsisinungaling o nagdadahilan',c:'Inaangkin niya ang trabaho ko',d:'Nag-aaksaya ng pagkain o gamit'} },
      lead:{ q:'Paano mo gusto makipagtrabaho ang iyong lider sa iyo?', o:{a:'Sabihin mo nang eksakto ang gagawin',b:'Sabihin ang layunin, ako na ang bahala sa paraan',c:'Madalas akong tingnan',d:'Hayaan mo ako maliban kung humingi ng tulong'} },
      priority_change:{ q:'Mabilis na nagbago ang plano habang shift mo. Ano ang nararamdaman mo?', o:{a:'Walang problema, mabilis akong nakakaangkop',b:'Hindi masaya, pero ginagawa ko',c:'Na-stress ako, kailangan ko ng sandali',d:'Pinapahirap nito ang araw ko'} },
      trust:{ q:'Ilang tao ba talaga ang mapagkakatiwalaan mo?', o:{a:'Halos lahat, mabuti ang karamihan',b:'Maraming tao',c:'Iilan lang',d:'Halos wala, madalas magsinungaling ang tao'} },
      pressure:{ q:'Kapag sobrang busy ang kusina at kulang sa tao, paano ka magtrabaho?' },
      promise:{ q:'May nagsabing gagawin niya ang isang bagay, pero hindi. Bakit?', o:{a:'May totoong dahilan na pumigil',b:'Nakalimutan niya',c:'Wala talaga siyang pakialam',d:'Ginagawa ito ng lahat, normal lang'} },
      protect:{ q:'Kapag may problema sa trabaho, kadalasan ang pinoprotektahan ng tao ay\u2026', o:{a:'Ang team',b:'Ang malalapit na kaibigan lang',c:'Ang sarili muna',d:'Ang lider'} },
      autonomy:{ q:'May kailangan kang ipasya at wala ang lider. Ano ang gagawin mo?', o:{a:'Maghihintay ako at magtatanong muna',b:'Magtatanong sa senior na malapit',c:'Ako na ang magpapasya sa maliliit',d:'Ako na ang magpapasya, sigurado ako'} },
      team_mood:{ q:'Karamihan sa kusinang ito ay nararamdaman\u2026', o:{a:'Masaya na nandito',b:'Okay lang, trabaho naman',c:'Pagod at na-stress',d:'Parang gustong umalis'} },
      fairness:{ q:'Dalawang tao ang gumagawa ng parehong trabaho. Mas pinupuri ang isa. Ang isa ay dapat\u2026', o:{a:'Matuwa para sa kanya',b:'Manahimik, magtrabaho lang',c:'Maramdamang hindi patas',d:'Magtrabaho nang mas kaunti sa susunod'} },
      next_year:{ q:'Saan mo nakikita ang sarili mo sa loob ng isang taon?', o:{a:'Dito, lumalago sa team na ito',b:'Dito, pero mas marami nang ginagawa',c:'Sa bagong lugar',d:'Hindi ko pa alam'} },
      stay:{ q:'Ano ang nagpapagusto sa iyong manatili sa trabaho? (pumili ng 2)', o:{a:'Iginagalang ako ng tao',b:'Magandang sahod',c:'Team na pinagkakatiwalaan ko',d:'Pagkakataong matuto at lumago',e:'May kahulugan ang trabaho ko',f:'Tahimik na lugar, walang stress'} },
      energy:{ q:'Sa dulo ng normal na shift, ano ang pakiramdam mo?', o:{a:'Malakas pa rin',b:'Pagod pero masaya',c:'Sobrang pagod',d:'May araw na okay, may araw na pagod'} },
      rules:{ q:'Ano ang iniisip mo tungkol sa mga patakaran sa trabaho?', o:{a:'Pinapanatili ng patakaran na ligtas at patas ang lahat',b:'Karamihan ng patakaran ay maganda',c:'May patakarang sayang sa oras',d:'Ang patakaran ay para labagin'} },
      remember:{ q:'Maraming maliliit na bagay na dapat mong tandaan sa isang araw. Ano ang totoo sa iyo?', o:{a:'Natatandaan ko lahat',b:'Isinusulat ko para hindi makalimutan',c:'Natatandaan ko lang ang mahahalaga',d:'Minsan nakakalimutan ko ang maliliit'} },
      change_one:{ q:'Kung may ISANG bagay kang mababago dito para gumanda ang trabaho mo, ano iyon?', ph:'Magsulat nang malaya, kahit anong wika.' },
      anything:{ q:'May iba ka pa bang gustong sabihin sa akin? (opsyonal)', ph:'Opsyonal — iwan na blangko kung wala. Kahit anong wika ay okay.' }
    }
  },

};

// i18n helpers
function T(){ return (TEAM_I18N[teamLang]||TEAM_I18N.en); }
function Tui(k){ var t=T().ui; return (t&&t[k]!=null)?t[k]:(TEAM_I18N.en.ui[k]||k); }
function Tq(qid){ var t=T().q[qid]; return t||TEAM_I18N.en.q[qid]; }
function Topt(qid,key){ var t=Tq(qid); return (t&&t.o&&t.o[key]!=null)?t.o[key]:(TEAM_I18N.en.q[qid].o[key]||key); }

async function openTeam() {
  activeStation = TEAM_KEY;
  hideAllPages();
  var el = document.getElementById('team-view');
  el.style.display = 'block';
  document.querySelector('.footer-bar').style.display = 'flex';
  document.getElementById('foot-label').textContent = 'Get to Know Us';
  teamMode = 'list'; teamCurrent = null; teamAnswers = {};
  await teamLoadStaff();
  await teamLoadCompletion();
  teamRender();
}

// Lightweight: which staff have submitted this round (names only)
var teamDoneNames = {};
var teamCompletionLoaded = false;
async function teamLoadCompletion(){
  try {
    var res = await sb.from('team_survey').select('staff_id,staff_name,submitted_at');
    teamDoneNames = {};
    (res.data||[]).forEach(function(r){ teamDoneNames[r.staff_id||r.staff_name]=true; });
    teamCompletionLoaded = true;
  } catch(e){ teamCompletionLoaded = false; }
}
function teamCompletionPct(){
  var total = teamStaff.length || 0;
  if(!total) return { pct:0, done:0, total:0 };
  var done = teamStaff.filter(function(s){ return teamDoneNames[s.id]||teamDoneNames[s.name]; }).length;
  return { pct: Math.round(done/total*100), done:done, total:total };
}
function teamFmtDate(iso){
  try { var d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
  catch(e){ return iso; }
}

async function teamLoadStaff() {
  try {
    var res = await sb.from('staff').select('*').eq('active', true).order('sort_order');
    teamStaff = res.data || [];
  } catch (e) { teamStaff = []; }
  var hasF = teamStaff.some(function(s){ return (s.name||'').toLowerCase().indexOf('francesco') !== -1; });
  if (!hasF) {
    teamStaff.unshift({ id:'francesco-mgmt', name:'Francesco Guarracino', designation:'Management', station_key:'management', _virtual:true });
  }
}

function teamRender() {
  var el = document.getElementById('team-view');
  if (teamMode === 'list')   { el.innerHTML = teamListHTML(); return; }
  if (teamMode === 'survey') { el.innerHTML = teamSurveyHTML(); teamUpdateProgress(); return; }
  if (teamMode === 'thanks') { el.innerHTML = teamThanksHTML(); return; }
  if (teamMode === 'admin')  { el.innerHTML = teamAdminHTML(); return; }
}

function teamSetLang(code){ teamLang = code; teamRender(); }

function teamListHTML() {
  var byStation = {};
  var order = ['management','pass','raw_bar','pasta','main','pastry_pizza','stewarding','other'];
  teamStaff.forEach(function(s) { var k=s.station_key||'other'; if(!byStation[k])byStation[k]=[]; byStation[k].push(s); });
  var html = '<div class="team-wrap"><div class="team-head">';
  html += '<div class="team-title">'+Tui('title')+'<span class="team-corner" id="team-corner" onclick="teamCornerTap()"></span></div>';
  html += '<div class="team-sub">'+Tui('intro')+'</div></div>';
  // completion strip — visible to everyone so the team sees progress; drives Danilo's task
  if (teamCompletionLoaded) {
    var c = teamCompletionPct();
    html += '<div class="team-progress-strip"><div class="tps-top"><span class="tps-pct">'+c.pct+'%</span><span class="tps-count">'+c.done+' / '+c.total+' done</span></div>';
    html += '<div class="tps-bar"><span class="tps-fill" style="width:'+c.pct+'%"></span></div>';
    html += '<div class="tps-dates"><span>Finish by '+teamFmtDate(TEAM_ROUND.deadline)+'</span><span>Next test '+teamFmtDate(TEAM_ROUND.nextTest)+'</span></div></div>';
  }
  // language picker
  html += '<div class="team-langbar"><div class="team-langlbl">'+Tui('pickLang')+'</div><div class="team-langs">';
  TEAM_LANGS.forEach(function(l){
    html += '<button class="team-lang'+(l.code===teamLang?' active':'')+'" onclick="teamSetLang(\''+l.code+'\')">'+l.label+'</button>';
  });
  html += '</div></div>';
  if (!teamStaff.length) { html += '<div class="team-empty">No team members loaded.</div>'; }
  else {
    function renderStation(k){
      if (!byStation[k]) return '';
      var h = '<div class="team-station">' + (TEAM_STATION_LABEL[k]||k) + '</div><div class="team-names">';
      byStation[k].forEach(function(s){
        var isDone = teamDoneNames[s.id]||teamDoneNames[s.name];
        h += '<button class="team-name-btn'+(isDone?' is-done':'')+'" onclick="teamStart(\'' + s.id + '\')"><span class="tn-name">' + (s.name||'') + (isDone?' <span class="tn-check">\u2713</span>':'') + '</span><span class="tn-role">' + (s.designation||'') + '</span></button>';
      });
      return h + '</div>';
    }
    order.forEach(function(k){ html += renderStation(k); });
    Object.keys(byStation).forEach(function(k){ if (order.indexOf(k)===-1) html += renderStation(k); });
  }
  html += '<div class="team-admin-link"><button onclick="teamAdminGate()">Admin view</button></div>';
  html += '</div>';
  return html;
}

// Passcode-gated admin entry (button visible, but team can't get in)
function teamAdminGate(){
  var code = prompt('Admin passcode:');
  if (code === null) return;
  if (String(code).trim() !== '1212') { alert('Incorrect passcode.'); return; }
  teamOpenAdmin();
}

function teamStart(staffId) {
  var person = teamStaff.find(function(s){ return s.id === staffId; });
  if (!person) return;
  // One per cycle: if this person already submitted this round, do not let them in again.
  var alreadyDone = teamDoneNames[person.id] || teamDoneNames[person.name];
  if (alreadyDone) {
    alert(person.name.split(' ')[0] + ', you have already completed this survey. Thank you — one per person each time. The next test is ' + teamFmtDate(TEAM_ROUND.nextTest) + '.');
    return;
  }
  var OVERRIDES = [ { match:'andrea', code:'100084' }, { match:'francesco', code:'1212' } ];
  var override = null;
  var lname = (person.name || '').toLowerCase();
  for (var oi=0; oi<OVERRIDES.length; oi++){ if (lname.indexOf(OVERRIDES[oi].match) !== -1){ override = OVERRIDES[oi]; break; } }
  var fn = person.name.split(' ')[0];
  if (override) {
    var oc = prompt(Tui('passPromptCode') + ', ' + fn + ':');
    if (oc === null) return;
    if (String(oc).trim() !== override.code) { alert(Tui('passWrong')); return; }
  } else if (person.emp_id) {
    var code = prompt(Tui('passPrompt') + ', ' + fn + ':');
    if (code === null) return;
    if (String(code).trim() !== String(person.emp_id).trim()) { alert(Tui('passWrong')); return; }
  } else {
    var ok = confirm(Tui('confirmNoId'));
    if (!ok) return;
  }
  teamCurrent = person;
  teamAnswers = {}; teamMode = 'survey'; teamScrollY = 0;
  teamRender();
  var v = document.getElementById('team-view'); if (v) v.scrollTop = 0;
}

function teamSurveyHTML() {
  var html = '<div class="team-wrap"><div class="team-head">';
  html += '<button class="team-back" onclick="teamBackToList()">&#8592; '+Tui('notMe')+'</button>';
  html += '<div class="team-title">' + (teamCurrent?teamCurrent.name:'') + '</div>';
  html += '<div class="team-sub">' + (teamCurrent?(teamCurrent.designation||''):'') + '</div></div>';
  TEAM_QUESTIONS.forEach(function(qq, idx) {
    var qt = Tq(qq.id);
    html += '<div class="team-q" id="tq-' + qq.id + '"><div class="team-q-num">' + (idx+1) + ' / ' + TEAM_QUESTIONS.length + '</div>';
    html += '<div class="team-q-text">' + qt.q + '</div>';
    if (qq.type==='single' || qq.type==='multi') {
      html += '<div class="team-opts">';
      qq.opts.forEach(function(opt){
        var sel = teamIsSelected(qq,opt.k) ? ' selected' : '';
        html += '<button class="team-opt' + sel + '" onclick="teamPick(\'' + qq.id + '\',\'' + opt.k + '\',\'' + qq.type + '\',' + (qq.max||1) + ')">' + Topt(qq.id,opt.k) + '</button>';
      });
      html += '</div>';
    } else if (qq.type==='scale') {
      html += '<div class="team-scale"><span class="team-scale-lbl">' + Tui('scaleLow') + '</span>';
      for (var n=1;n<=5;n++){ var ssel=(teamAnswers[qq.id]===n)?' selected':''; html += '<button class="team-scale-btn' + ssel + '" onclick="teamScale(\'' + qq.id + '\',' + n + ')">' + n + '</button>'; }
      html += '<span class="team-scale-lbl">' + Tui('scaleHigh') + '</span></div>';
    } else if (qq.type==='text') {
      html += '<textarea class="team-text" id="tt-' + qq.id + '" placeholder="' + (qt.ph||'') + '" oninput="teamTextInput(\'' + qq.id + '\', this.value)">' + (teamAnswers[qq.id]||'') + '</textarea>';
    }
    html += '</div>';
  });
  html += '<div class="team-submit-wrap"><div class="team-progress" id="team-progress"></div>';
  html += '<button class="team-submit" id="team-submit-btn" onclick="teamSubmit()">'+Tui('send')+'</button></div></div>';
  return html;
}

function teamIsSelected(qq,key){ var v=teamAnswers[qq.id]; if(qq.type==='multi')return Array.isArray(v)&&v.indexOf(key)!==-1; return v===key; }
function teamPick(qid,key,type,max){
  if(type==='single'){ teamAnswers[qid]=key; }
  else { var arr=Array.isArray(teamAnswers[qid])?teamAnswers[qid]:[]; var i=arr.indexOf(key); if(i!==-1)arr.splice(i,1); else{ if(arr.length>=max)arr.shift(); arr.push(key);} teamAnswers[qid]=arr; }
  teamRender(); teamRestoreScroll();
}
function teamScale(qid,n){ teamAnswers[qid]=n; teamRender(); teamRestoreScroll(); }
function teamTextInput(qid,val){ teamAnswers[qid]=val; teamUpdateProgress(); }
function teamRestoreScroll(){ var v=document.getElementById('team-view'); if(v)v.scrollTop=teamScrollY; teamUpdateProgress(); }
function teamUpdateProgress(){
  var required = TEAM_QUESTIONS.filter(function(q){return !q.optional;});
  var done = required.filter(function(q){ var v=teamAnswers[q.id]; if(Array.isArray(v))return v.length>0; if(q.type==='text')return v&&v.trim().length>0; return v!==undefined&&v!==null&&v!==''; }).length;
  var p=document.getElementById('team-progress'); if(p)p.textContent=done+' '+Tui('of')+' '+required.length+' '+Tui('answered');
  var btn=document.getElementById('team-submit-btn');
  if(btn){ if(done>=required.length){btn.classList.add('ready');btn.textContent=Tui('send');} else {btn.classList.remove('ready');btn.textContent=Tui('answerAll');} }
}
document.addEventListener('scroll', function(e){ if(teamMode==='survey'&&e.target&&e.target.id==='team-view')teamScrollY=e.target.scrollTop; }, true);
function teamBackToList(){ teamMode='list'; teamCurrent=null; teamAnswers={}; teamRender(); }

async function teamSubmit() {
  var required = TEAM_QUESTIONS.filter(function(q){return !q.optional;});
  var missing = required.filter(function(q){ var v=teamAnswers[q.id]; if(Array.isArray(v))return v.length===0; if(q.type==='text')return !v||!v.trim().length; return v===undefined||v===null||v===''; });
  if(missing.length){
    var first = missing[0];
    var el = document.getElementById('tq-' + first.id);
    if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); el.classList.add('team-q-missing'); setTimeout(function(){ el.classList.remove('team-q-missing'); }, 2200); }
    return;
  }
  var btn=document.getElementById('team-submit-btn'); if(btn){btn.disabled=true;btn.textContent=Tui('sending');}
  var row = { staff_id:(teamCurrent._virtual?null:teamCurrent.id), staff_name:teamCurrent.name, designation:teamCurrent.designation||null, station_key:teamCurrent.station_key||null, answers:teamAnswers, lang:teamLang, submitted_at:new Date().toISOString() };
  try { var res=await sb.from('team_survey').insert(row); if(res.error)throw res.error; teamMode='thanks'; teamRender(); }
  catch(e){ if(btn){btn.disabled=false;btn.textContent=Tui('send');} alert('Could not send — please try again.\n'+(e.message||'')); }
}

function teamThanksHTML(){
  return '<div class="team-wrap team-thanks"><div class="team-thanks-tick">&#10003;</div>' +
    '<div class="team-title">' + Tui('thanks') + ', ' + (teamCurrent?teamCurrent.name.split(' ')[0]:'') + '</div>' +
    '<div class="team-sub">' + Tui('thanksMsg') + '</div>' +
    '<button class="team-submit ready" onclick="teamBackToList()">'+Tui('done')+'</button></div>';
}

// ── Scoring (reads option KEYS, language-independent) ──
function teamScoreOne(answers){
  var raw={rel:0,int:0,loy:0,eng:0,flight:0,concern:0};
  var maxAbs={rel:0,int:0,loy:0,eng:0,flight:0,concern:0};
  TEAM_QUESTIONS.forEach(function(q){
    var v=answers[q.id];
    if(q.type==='scale'&&q.score&&q.score.map){
      var dim=q.score.dim;
      var contribs=Object.keys(q.score.map).map(function(k){return Math.abs(q.score.map[k]);});
      maxAbs[dim]+=Math.max.apply(null,contribs);
      if(v&&q.score.map[v]!==undefined)raw[dim]+=q.score.map[v];
      return;
    }
    if(!q.opts)return;
    // max possible per dim from this question's options
    var perDim={};
    q.opts.forEach(function(o){ if(!o.score)return; Object.keys(o.score).forEach(function(d){ perDim[d]=Math.max(perDim[d]||0,Math.abs(o.score[d])); }); });
    Object.keys(perDim).forEach(function(d){ maxAbs[d]+=perDim[d]; });
    var sel=Array.isArray(v)?v:(v!=null?[v]:[]);
    sel.forEach(function(key){
      var o=null; for(var i=0;i<q.opts.length;i++){ if(q.opts[i].k===key){o=q.opts[i];break;} }
      if(o&&o.score)Object.keys(o.score).forEach(function(d){ raw[d]+=o.score[d]; });
    });
  });
  // ── Cross-check pairs: contradiction softens the dimension toward caution ──
  var contradictions=[];
  TEAM_CROSSCHECKS.forEach(function(cc){
    if(cc.contradiction(answers)){
      contradictions.push(cc);
      // soften: pull the raw score for that dim toward 0 (neutral/cautious)
      var dimMap={loyalty:'loy',integrity:'int',reliability:'rel',engagement:'eng'};
      var d=dimMap[cc.dim]; if(d!=null){ raw[d]=raw[d]*0.4; }
    }
  });
  function norm(d){ if(!maxAbs[d])return null; var v=Math.round(50+(raw[d]/maxAbs[d])*50); return Math.max(0,Math.min(100,v)); }
  return { reliability:norm('rel'), integrity:norm('int'), loyalty:norm('loy'), engagement:norm('eng'),
           flightRaw:raw.flight, flightMax:maxAbs.flight, concernRaw:raw.concern, contradictions:contradictions };
}

function teamFlags(s,answers){
  var flags=[];
  // Flight risk — strong if direct (plans to leave), else soft from accumulated signal
  if(s.flightMax>0){
    var fr=s.flightRaw/s.flightMax;
    if(answers.next_year==='c'||answers.team_mood==='d') flags.push({k:'Flight risk',level:'strong',txt:'Signs they may be leaving'});
    else if(fr>=0.5) flags.push({k:'Flight risk',level:'soft',txt:'Some signs of looking elsewhere'});
  }
  if(s.integrity!==null){
    if(s.integrity<=28)flags.push({k:'Integrity',level:'strong',txt:'Concerning pattern on the honesty questions'});
    else if(s.integrity<=40)flags.push({k:'Integrity',level:'soft',txt:'One or two self-serving answers — worth a normal eye'});
    else if(s.integrity>=82)flags.push({k:'Integrity',level:'good',txt:'Clear, settled honesty'});
  }
  if(s.engagement!==null){
    if(s.engagement<=28)flags.push({k:'Burnout / low engagement',level:'strong',txt:'Running on empty'});
    else if(s.engagement<=42)flags.push({k:'Engagement dip',level:'soft',txt:'Energy is fading'});
    else if(s.engagement>=80)flags.push({k:'Engaged',level:'good',txt:'Genuinely invested'});
  }
  if(s.reliability!==null){
    if(s.reliability<=32)flags.push({k:'Reliability',level:'soft',txt:'May struggle to follow through under pressure'});
    else if(s.reliability>=80)flags.push({k:'Reliable',level:'good',txt:'Dependable under pressure'});
  }
  if(s.loyalty!==null&&s.loyalty>=78)flags.push({k:'Loyal',level:'good',txt:'Wants to stay and build here'});
  if(s.concernRaw>=2)flags.push({k:'Concerns raised',level:'soft',txt:'Flagged several frustrations'});
  // Cross-check contradictions → their own soft flag
  (s.contradictions||[]).forEach(function(cc){
    flags.push({k:'Answers don\u2019t line up',level:'soft',txt:cc.note});
  });
  return flags;
}

async function teamOpenAdmin(){
  // DEV-only safety net: report never opens on the LIVE host even if the tap pattern is found.
  var host = (location.hostname || '').toLowerCase();
  var isDev = host.indexOf('robertos-kitchen.github.io') !== -1 || host === 'localhost' || host === '127.0.0.1';
  if (!isDev) { return; }
  teamMode='admin';
  try { var res=await sb.from('team_survey').select('*').order('submitted_at',{ascending:false}); teamSubmissions=res.data||[]; }
  catch(e){ teamSubmissions=[]; }
  teamRender();
}

function teamBar(label,val){
  if(val===null)return '<div class="ta-bar-row"><span>'+label+'</span><span class="ta-na">no data</span></div>';
  var cls=val>=70?'hi':(val>=45?'mid':'lo');
  return '<div class="ta-bar-row"><span>'+label+'</span><span class="ta-bar"><span class="ta-bar-fill '+cls+'" style="width:'+val+'%"></span></span><span class="ta-val">'+val+'</span></div>';
}

// Word label for a 0-100 score by dimension
function teamWord(dim,v){
  if(v===null)return 'no data';
  if(dim==='integrity'){ if(v>=80)return 'Strong'; if(v>=60)return 'Solid'; if(v>=45)return 'Mixed'; return 'Watch'; }
  if(dim==='engagement'){ if(v>=75)return 'Engaged'; if(v>=55)return 'Good'; if(v>=40)return 'Tiring'; return 'Watch'; }
  if(dim==='loyalty'){ if(v>=75)return 'High'; if(v>=55)return 'Good'; if(v>=40)return 'Mixed'; return 'Low'; }
  // reliability
  if(v>=75)return 'High'; if(v>=55)return 'Solid'; if(v>=40)return 'Mixed'; return 'Watch';
}
// One sentence explaining a person's dimension, driven by their actual answers
function teamExplain(dim,v,a){
  if(v===null)return '';
  if(dim==='reliability'){
    if(v>=70)return 'Copes under pressure and follows through. You can lean on them.';
    if(v>=45)return 'Mostly steady, but can wobble when things pile up.';
    return 'May struggle to follow through when it gets hard — needs structure.';
  }
  if(dim==='integrity'){
    if(v>=80)return 'Consistently chose the honest line on the everyday questions. (Self-report — proof is behaviour over time.)';
    if(v>=60)return 'Largely honest answers, nothing concerning.';
    if(v>=45)return 'One or two self-serving answers — worth a normal eye, not alarm.';
    return 'Several self-serving choices on everyday situations — keep an eye, never treat as proof.';
  }
  if(dim==='loyalty'){
    if(v>=75)return 'Wants to stay and build here — invest in them.';
    if(v>=55)return 'Reasonably settled, open to growing here.';
    if(v>=40)return 'Mixed feelings about staying — could go either way.';
    return 'Little attachment — at risk of drifting away.';
  }
  // engagement
  if(v>=75)return 'Genuinely invested and energised.';
  if(v>=55)return 'Engaged but feeling the load — watch it does not slide.';
  if(v>=40)return 'Energy is fading — tired more than inspired.';
  return 'Running on empty — burnout risk.';
}
// One-line verdict for a person
function teamVerdict(s,flags){
  var strong=flags.filter(function(f){return f.level==='strong';});
  var leaving=flags.some(function(f){return f.k==='Flight risk';});
  var burn=flags.some(function(f){return f.k.indexOf('Burnout')!==-1;});
  var intg=flags.some(function(f){return f.k==='Integrity'&&f.level!=='good';});
  var loyalPos=(s.loyalty!==null&&s.loyalty>=75);
  if(intg&&strong.length)return 'Capable but gave concerning honesty answers — watch closely before trusting further.';
  if(burn&&leaving)return 'Burning out AND looking around — act soon or you will lose them.';
  if(burn)return 'Doing the work but running on empty — relieve the load before it becomes a resignation.';
  if(leaving)return 'Showing they may be on the way out — have the conversation now.';
  if(loyalPos&&(s.reliability===null||s.reliability>=60))return 'Dependable and committed — a keeper, give them a path.';
  if(!flags.length||flags.every(function(f){return f.level==='good';}))return 'Settled and positive across the board. No concerns.';
  return 'Mostly solid with a couple of soft signals worth a casual check-in.';
}

function teamAdminHTML(){
  var latest={};
  teamSubmissions.forEach(function(r){ var key=r.staff_id||r.staff_name; if(!latest[key])latest[key]=r; });
  var subs=Object.keys(latest).map(function(k){return latest[k];});
  var total=teamStaff.length;
  var completedIds={}; subs.forEach(function(r){ completedIds[r.staff_id||r.staff_name]=true; });
  var completed=teamStaff.filter(function(s){return completedIds[s.id]||completedIds[s.name];}).length;
  function avg(arr){ return arr.length?Math.round(arr.reduce(function(x,y){return x+y;},0)/arr.length):null; }

  var html='<div class="team-wrap"><div class="team-head"><button class="team-back" onclick="openTeam()">&#8592; Back</button>';
  html+='<div class="team-title">Team Report</div>';
  html+='<div class="team-sub">'+TEAM_ROUND.label+'. Honest signals, not verdicts — strong flags are reliable, soft ones are conversations to have.</div></div>';
  // completion banner
  var pct = total ? Math.round(completed/total*100) : 0;
  html+='<div class="ta-completion"><div class="tps-top"><span class="tps-pct">'+pct+'%</span><span class="tps-count">'+completed+' / '+total+' completed</span></div>';
  html+='<div class="tps-bar"><span class="tps-fill" style="width:'+pct+'%"></span></div>';
  html+='<div class="tps-dates"><span>Deadline '+teamFmtDate(TEAM_ROUND.deadline)+'</span><span>Next test '+teamFmtDate(TEAM_ROUND.nextTest)+'</span></div></div>';

  if(subs.length){
    // global aggregates + flag tallies
    var agg={reliability:[],integrity:[],loyalty:[],engagement:[]};
    var flightStrong=[],flightSoft=[],integritySoft=[],integrityStrong=[],burnout=[],loyal=[];
    var concernsText=[];
    subs.forEach(function(r){
      var s=teamScoreOne(r.answers||{});
      ['reliability','integrity','loyalty','engagement'].forEach(function(d){ if(s[d]!==null)agg[d].push(s[d]); });
      teamFlags(s,r.answers||{}).forEach(function(f){
        if(f.k==='Flight risk'&&f.level==='strong')flightStrong.push(r.staff_name);
        if(f.k==='Flight risk'&&f.level==='soft')flightSoft.push(r.staff_name);
        if(f.k==='Integrity'&&f.level==='soft')integritySoft.push(r.staff_name);
        if(f.k==='Integrity'&&f.level==='strong')integrityStrong.push(r.staff_name);
        if(f.k.indexOf('Burnout')!==-1)burnout.push(r.staff_name);
        if(f.k==='Loyal')loyal.push(r.staff_name);
      });
      var c1=(r.answers||{}).change_one; if(c1&&c1.trim())concernsText.push({n:r.staff_name,t:c1.trim()});
    });

    // ── headline ──
    html+='<div class="ta-overview"><div class="ta-section-title">Where you stand today</div>';
    html+='<div class="ta-headline">';
    var head=[];
    head.push('Honesty looks '+(avg(agg.integrity)>=60?'solid':'mixed')+' and the team is '+(avg(agg.reliability)>=60?'dependable':'uneven')+' under pressure.');
    if(burnout.length||flightStrong.length) head.push('The real risk is energy and retention — '+(burnout.length?burnout.length+' running low':'')+(burnout.length&&flightStrong.length?', and ':'')+(flightStrong.length?flightStrong.length+' may be on the way out':'')+'.');
    else head.push('No urgent flight or burnout signals right now.');
    html+=head.join(' ')+'</div>';

    // ── team averages ──
    html+='<div class="ta-section-title" style="margin-top:14px">Team averages</div>';
    [['reliability','Reliability'],['integrity','Integrity'],['loyalty','Loyalty'],['engagement','Engagement']].forEach(function(d){
      var v=avg(agg[d[0]]);
      html+='<div class="ta-avgrow">'+teamBar(d[1]+' &middot; '+teamWord(d[0],v),v)+'</div>';
    });

    // ── what needs attention (prioritised) ──
    html+='<div class="ta-section-title" style="margin-top:16px">What needs your attention</div><div class="ta-attn">';
    if(burnout.length) html+='<div class="ta-attn-row hi"><b>'+burnout.length+' burning out</b> — '+burnout.join(', ')+'. Energy is the most urgent thing; burnout becomes resignation if ignored.</div>';
    if(flightStrong.length) html+='<div class="ta-attn-row hi"><b>'+flightStrong.length+' clear flight risk</b> — '+flightStrong.join(', ')+'. Have the conversation now.</div>';
    if(flightSoft.length) html+='<div class="ta-attn-row mid"><b>'+flightSoft.length+' restless (soft)</b> — '+flightSoft.join(', ')+'. A quiet one-to-one before it hardens.</div>';
    if(integrityStrong.length) html+='<div class="ta-attn-row hi"><b>'+integrityStrong.length+' integrity concern</b> — '+integrityStrong.join(', ')+'. Watch closely (still not proof).</div>';
    if(integritySoft.length) html+='<div class="ta-attn-row mid"><b>'+integritySoft.length+' integrity worth a look (soft)</b> — '+integritySoft.join(', ')+'. Normal eye, no alarm.</div>';
    if(loyal.length) html+='<div class="ta-attn-row good"><b>'+loyal.length+' solid and committed</b> — '+loyal.join(', ')+'. Your dependable core — give the growth-minded ones a path.</div>';
    if(!burnout.length&&!flightStrong.length&&!flightSoft.length&&!integritySoft.length&&!integrityStrong.length&&!loyal.length) html+='<div class="ta-attn-row good">No flags raised. A calm, settled set of responses.</div>';
    html+='</div>';

    // ── their words ──
    if(concernsText.length){
      html+='<div class="ta-section-title" style="margin-top:16px">In their words — what they would change</div>';
      concernsText.slice(0,15).forEach(function(o){ html+='<div class="ta-quote">"'+o.t+'" <span>— '+o.n+'</span></div>'; });
    }
    html+='</div>';

    // ── PER-SECTION breakdown ──
    html+='<div class="team-station">By section</div>';
    TEAM_SECTIONS.forEach(function(sec){
      var members=subs.filter(function(r){ return teamSectionFor(r.station_key).key===sec.key; });
      if(!members.length)return;
      var sa={reliability:[],integrity:[],loyalty:[],engagement:[]};
      members.forEach(function(r){ var s=teamScoreOne(r.answers||{}); ['reliability','integrity','loyalty','engagement'].forEach(function(d){ if(s[d]!==null)sa[d].push(s[d]); }); });
      html+='<div class="ta-section-card"><div class="ta-section-head">'+sec.label+' <span>'+members.length+(members.length===1?' person':' people')+'</span></div>';
      html+=teamBar('Reliability',avg(sa.reliability))+teamBar('Integrity',avg(sa.integrity))+teamBar('Loyalty',avg(sa.loyalty))+teamBar('Engagement',avg(sa.engagement));
      html+='</div>';
    });
  }

  // ── completion ──
  html+='<div class="team-station">Completion</div><div class="team-admin-status">';
  TEAM_SECTIONS.forEach(function(sec){
    var inSec=teamStaff.filter(function(s){ return teamSectionFor(s.station_key).key===sec.key; });
    if(!inSec.length)return;
    inSec.forEach(function(s){ var ok=completedIds[s.id]||completedIds[s.name]; html+='<div class="team-status-row '+(ok?'is-done':'is-pending')+'"><span>'+s.name+' <em style="opacity:.5;font-style:normal;font-size:11px">'+sec.label+'</em></span><span>'+(ok?'✓ done':'waiting')+'</span></div>'; });
  });
  html+='</div>';

  // ── INDIVIDUAL readouts, grouped by section ──
  html+='<div class="team-station">Individual reports</div>';
  if(!subs.length)html+='<div class="team-empty">No responses yet.</div>';
  TEAM_SECTIONS.forEach(function(sec){
    var members=subs.filter(function(r){ return teamSectionFor(r.station_key).key===sec.key; });
    if(!members.length)return;
    html+='<div class="ta-secdiv">'+sec.label+'</div>';
    members.forEach(function(r){
      var a=r.answers||{}; var s=teamScoreOne(a); var flags=teamFlags(s,a);
      html+='<div class="ta-person"><div class="ta-person-name">'+r.staff_name+' <span>'+(r.designation||'')+'</span></div>';
      html+='<div class="ta-oneline">'+teamVerdict(s,flags)+'</div>';
      [['reliability','Reliability'],['integrity','Integrity'],['loyalty','Loyalty'],['engagement','Engagement']].forEach(function(d){
        var v=s[d[0]];
        html+='<div class="ta-dim"><div class="ta-dim-top"><span class="ta-dim-name">'+d[1]+'</span><span class="ta-dim-word">'+(v===null?'no data':v+' &middot; '+teamWord(d[0],v))+'</span></div>';
        html+=teamBar('',v);
        html+='<div class="ta-dim-exp">'+teamExplain(d[0],v,a)+'</div></div>';
      });
      if(flags.length){
        html+='<div class="ta-flags">';
        flags.forEach(function(f){ html+='<span class="ta-flag lv-'+f.level+'">'+f.k+' <em>'+f.level+'</em></span>'; });
        html+='</div>';
      }
      // motivators / drains in words
      if(Array.isArray(a.motivate)&&a.motivate.length) html+='<div class="ta-said"><b>Motivated by:</b> '+a.motivate.map(function(k){return TEAM_I18N.en.q.motivate.o[k]||k;}).join(', ')+'</div>';
      if(Array.isArray(a.drains)&&a.drains.length) html+='<div class="ta-said"><b>Drained by:</b> '+a.drains.map(function(k){return TEAM_I18N.en.q.drains.o[k]||k;}).join(', ')+'</div>';
      if(a.change_one&&a.change_one.trim())html+='<div class="ta-said"><b>Would change:</b> '+a.change_one.trim()+'</div>';
      if(a.anything&&a.anything.trim())html+='<div class="ta-said"><b>Also said:</b> '+a.anything.trim()+'</div>';
      html+='</div>';
    });
  });

  html+='<div class="ta-footer">A short survey points, it does not prove. Strong flags are reliable; soft flags are conversations to have, never verdicts to act on alone. Re-run every 3 months to see who is trending up or down.</div>';
  html+='</div>';
  return html;
}

// ── Secret admin access: tap the title's top-right corner 5x within 3s ──
var teamCornerTaps = [];
function teamCornerTap() {
  var now = Date.now();
  teamCornerTaps = teamCornerTaps.filter(function(t){ return now - t < 3000; });
  teamCornerTaps.push(now);
  if (teamCornerTaps.length >= 5) {
    teamCornerTaps = [];
    teamOpenAdmin();
  }
}

// ── Home screen collapsible panels (Daily Operations / Management) ──
function toggleHomePanel(which){
  var panel = document.getElementById(which + '-panel');
  var chev  = document.getElementById(which + '-chev');
  if (!panel) return;
  var isOpen = panel.style.display !== 'none' && panel.style.display !== '';
  panel.style.display = isOpen ? 'none' : 'grid';
  if (chev) chev.classList.toggle('open', !isOpen);
}

// ── Inject survey completion card into the Dashboard (non-invasive wrapper) ──
(function(){
  if (typeof window === 'undefined') return;
  function injectCompletionCard(){
    var view = document.getElementById('dashboard-view');
    if (!view) return;
    if (document.getElementById('dash-survey-card')) return; // already added
    var grid = view.querySelector('.ops-grid');
    if (!grid) return;
    // fetch completion if not loaded
    var render = function(){
      var c = teamCompletionPct();
      var card = document.createElement('div');
      card.className = 'ops-card';
      card.id = 'dash-survey-card';
      card.style.cursor = 'pointer';
      card.onclick = function(){ openTeam(); };
      card.innerHTML = '<div class="ops-num">'+c.pct+'%</div><div class="ops-label">Survey done ('+c.done+'/'+c.total+')</div>';
      grid.appendChild(card);
    };
    if (teamCompletionLoaded && teamStaff.length){ render(); }
    else {
      Promise.resolve().then(async function(){
        try { if(!teamStaff.length) await teamLoadStaff(); await teamLoadCompletion(); render(); } catch(e){}
      });
    }
  }
  var _wrapDashboard = function(){
    if (typeof window.openDashboard !== 'function' || window.openDashboard.__teamWrapped) return;
    var _orig = window.openDashboard;
    window.openDashboard = function(){ _orig.apply(this, arguments); setTimeout(injectCompletionCard, 60); };
    window.openDashboard.__teamWrapped = true;
  };
  if (document.readyState !== 'loading') setTimeout(_wrapDashboard, 0);
  document.addEventListener('DOMContentLoaded', _wrapDashboard);
  window.addEventListener('load', _wrapDashboard);
})();
