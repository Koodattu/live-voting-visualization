import type { SessionLanguage } from "../shared/contracts.js";

const messages = {
  en: {
    joined: "joined",
    lobbyEyebrow: "You’re in",
    lobbyTitle: "Waiting for the first Question",
    lobbyBody: "The presenter will move everyone forward together.",
    open: "Open for voting",
    closed: "Voting closed",
    choose: "Choose one Option",
    chosen: "Response saved",
    saving: "Saving…",
    update: "You can change your response while voting is open.",
    commentPlaceholder: "Write a short Comment…",
    submitComment: "Submit Comment",
    updateComment: "Update Comment",
    commentLimit: "160 characters maximum",
    resultsTitle: "Session Results",
    resultsBody: "Thanks for taking part.",
    responses: "responses",
    participation: "participation",
    noResponses: "No responses yet",
    noComments: "No Comments.",
    commentsHidden: "Comments hidden by the presenter.",
    previous: "Previous",
    joinAt: "Join at",
    scan: "Scan to join",
    wallHidden: "Comment Wall hidden",
    completed: "Session complete",
    completedBody: "Thanks for being here.",
    feedback: "Comments",
    connecting: "Connecting to the session…",
  },
  fi: {
    joined: "liittynyt",
    lobbyEyebrow: "Olet mukana",
    lobbyTitle: "Odotetaan ensimmäistä kysymystä",
    lobbyBody: "Esittäjä vie kaikki seuraavaan vaiheeseen yhtä aikaa.",
    open: "Äänestys on auki",
    closed: "Äänestys on päättynyt",
    choose: "Valitse yksi vaihtoehto",
    chosen: "Vastaus tallennettu",
    saving: "Tallennetaan…",
    update: "Voit vaihtaa vastaustasi niin kauan kuin äänestys on auki.",
    commentPlaceholder: "Kirjoita lyhyt kommentti…",
    submitComment: "Lähetä kommentti",
    updateComment: "Päivitä kommentti",
    commentLimit: "Enintään 160 merkkiä",
    resultsTitle: "Tulokset",
    resultsBody: "Kiitos osallistumisesta.",
    responses: "vastausta",
    participation: "osallistuminen",
    noResponses: "Ei vielä vastauksia",
    noComments: "Ei kommentteja.",
    commentsHidden: "Esittäjä on piilottanut kommentit.",
    previous: "Edellinen",
    joinAt: "Liity osoitteessa",
    scan: "Liity skannaamalla",
    wallHidden: "Kommenttiseinä on piilotettu",
    completed: "Tilaisuus on päättynyt",
    completedBody: "Kiitos osallistumisesta.",
    feedback: "Kommentit",
    connecting: "Yhdistetään äänestykseen…",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

export function translate(
  language: SessionLanguage,
  key: MessageKey,
): string {
  return messages[language][key];
}

const finnishResponseErrors: Record<string, string> = {
  comment_required: "Kirjoita lyhyt kommentti.",
  invalid_comment: "Kommentin pituuden on oltava 1–160 merkkiä.",
  invalid_option: "Valittu vaihtoehto ei kuulu tähän kysymykseen.",
  invalid_response: "Tarkista vastaus.",
  option_required: "Valitse yksi vaihtoehto.",
  participant_required: "Liity äänestykseen ennen vastaamista.",
  question_not_open: "Tähän kysymykseen ei voi enää vastata.",
  rate_limited: "Odota hetki ennen kuin vastaat uudelleen.",
  request_id_reused: "Vastauspyyntöä ei voitu käsitellä uudelleen.",
  session_not_live: "Tämä äänestys ei enää ota vastaan vastauksia.",
};

export function translateResponseError(
  language: SessionLanguage,
  code: string,
  fallback: string,
): string {
  return language === "fi" ? finnishResponseErrors[code] ?? fallback : fallback;
}
