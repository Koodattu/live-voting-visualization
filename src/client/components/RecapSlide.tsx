import type { SessionLanguage, SessionRecap } from "../../shared/contracts.js";
import { translate } from "../i18n.js";

const chartColors = ["var(--green)", "var(--accent)", "#879bce", "#bc923e", "#ad75b3", "#718b8d"];

export function RecapSlide({ recap, language }: { recap: SessionRecap; language: SessionLanguage }) {
  const content = recap.content;
  if (recap.status !== "ready" || !content) {
    return (
      <section className="recap-slide recap-slide--waiting" role="status" aria-live="polite">
        <span className="eyebrow">{translate(language, "aiRecap")}</span>
        <span className={recap.status === "generating" ? "recap-pulse" : "recap-mark"} aria-hidden="true">✦</span>
        <h2>{translate(language, recap.status === "failed" ? "recapFailed" : "recapLoading")}</h2>
        <p>{translate(language, recap.status === "failed" ? "recapFailedBody" : "recapLoadingBody")}</p>
      </section>
    );
  }
  const chart = content.chart;
  let offset = 0;
  const segments = chart?.style === "donut" ? chart.items.map((item, index) => {
    const start = offset;
    offset += item.count / item.total * 100;
    return `${chartColors[index]} ${start}% ${offset}%`;
  }).join(", ") : "";

  return (
    <section className={`recap-slide${chart ? " recap-slide--chart" : ""}`} aria-live="polite">
      <header className="recap-heading">
        <span className="eyebrow">{translate(language, "audiencePulse")}</span>
        <h2>{content.headline}</h2>
      </header>
      <div className="recap-body">
        <div className="recap-copy">
          <p className="recap-summary">{content.summary}</p>
          {content.highlights.length > 0 && (
            <ul className="recap-highlights">
              {content.highlights.map((highlight, index) => <li key={index}>{highlight}</li>)}
            </ul>
          )}
        </div>
        {chart && (
          <figure className="recap-chart">
            <figcaption>{chart.title}</figcaption>
            {chart.style === "donut" && (
              <div className="recap-donut" style={{ background: `conic-gradient(${segments})` }} aria-hidden="true">
                <span><strong className="tabular">{chart.items[0]?.total}</strong><small>{translate(language, "responses")}</small></span>
              </div>
            )}
            <div className="recap-chart-items">
              {chart.items.map((item, index) => (
                <div className="recap-chart-item" key={index}>
                  <div className="recap-chart-label">
                    <span><i style={{ background: chartColors[index] }} aria-hidden="true" />{item.label}</span>
                    <strong className="tabular">{item.percentage.toFixed(1)}%</strong>
                  </div>
                  {chart.style === "bar" && <div className="result-track" aria-hidden="true"><span style={{ width: `${item.percentage}%`, background: chartColors[index] }} /></div>}
                  <small>{item.sourceQuestion} · {item.sourceOptions.join(" + ")} · <span className="tabular">{item.count}/{item.total}</span> {translate(language, "responses")}</small>
                </div>
              ))}
            </div>
          </figure>
        )}
      </div>
      <footer className="recap-footer">{translate(language, "recapAttribution")}</footer>
    </section>
  );
}
