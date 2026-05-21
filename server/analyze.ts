import { negativeWords, positiveWords, topicLexicon } from "./config";
import { clamp, compactText, uniq } from "./utils";
import type { ContentPart, MonitorItem, RiskLevel, Sentiment } from "../src/shared";

interface AnalyzeInput {
  contentParts: ContentPart[];
  metrics: MonitorItem["metrics"];
  title: string;
}

export function analyzeItem(input: AnalyzeInput) {
  const content = input.contentParts
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n");

  const topics = Object.entries(topicLexicon)
    .filter(([, words]) => words.some((word) => content.includes(word)))
    .map(([topic]) => topic);

  const sentimentScore = scoreSentiment(content);
  const sentiment = labelSentiment(sentimentScore, content);
  const keywords = extractKeywords(content, topics);
  const risk = assessRisk(content, sentimentScore, input.metrics);
  const summary = summarizeContent(input.title, input.contentParts, topics, sentiment);

  return {
    topics: topics.length ? topics : ["综合讨论"],
    sentiment,
    sentimentScore,
    keywords,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    summary
  };
}

function scoreSentiment(content: string) {
  let positive = 0;
  let negative = 0;

  for (const word of positiveWords) {
    positive += countOccurrences(content, word);
  }
  for (const word of negativeWords) {
    negative += countOccurrences(content, word);
  }

  if (content.includes("？") || content.includes("?")) negative += 0.4;
  if (content.includes("！！") || content.includes("!!")) negative += 0.3;

  const total = positive + negative;
  if (!total) return 0;
  return clamp((positive - negative) / Math.max(2, total), -1, 1);
}

function labelSentiment(score: number, content: string): Sentiment {
  const hasPositive = positiveWords.some((word) => content.includes(word));
  const hasNegative = negativeWords.some((word) => content.includes(word));
  if (hasPositive && hasNegative && Math.abs(score) < 0.25) return "mixed";
  if (score > 0.18) return "positive";
  if (score < -0.18) return "negative";
  return "neutral";
}

function extractKeywords(content: string, topics: string[]) {
  const domainWords = uniq(Object.values(topicLexicon).flat());
  const matched = domainWords.filter((word) => content.includes(word));
  const english = content.match(/[A-Za-z][A-Za-z0-9+-]{1,12}/g) || [];
  const numbers = content.match(/\d{1,4}(?:\.\d+)?(?:月|日|版本|战力|元)?/g) || [];

  return uniq([...topics, ...matched, ...english, ...numbers])
    .filter((word) => word.length > 1)
    .slice(0, 10);
}

function assessRisk(content: string, sentimentScore: number, metrics: MonitorItem["metrics"]) {
  const engagement =
    (metrics.views || 0) * 0.002 +
    (metrics.replies || 0) * 2 +
    (metrics.comments || 0) * 2 +
    (metrics.danmaku || 0) * 1.2 +
    (metrics.likes || 0) * 0.2 +
    (metrics.shares || 0) * 0.4;

  const reasons: string[] = [];
  if (sentimentScore < -0.35) reasons.push("负面表达集中");
  if (engagement > 800) reasons.push("互动量较高");
  if (/(外挂|封号|倒闭|破游戏|没救|白氪|BUG|bug|炸服|闪退)/.test(content)) {
    reasons.push("命中敏感风险词");
  }
  if (/(水军|诈骗|未成年|退款|投诉)/.test(content)) {
    reasons.push("命中治理类风险词");
  }

  let level: RiskLevel = "low";
  if (reasons.length >= 2 || (sentimentScore < -0.45 && engagement > 250)) {
    level = "high";
  } else if (reasons.length === 1 || sentimentScore < -0.25) {
    level = "medium";
  }

  return { level, reasons };
}

function summarizeContent(title: string, parts: ContentPart[], topics: string[], sentiment: Sentiment) {
  const comments = parts.filter((part) => part.type === "comment" || part.type === "danmaku" || part.type === "post");
  const base = compactText(
    [
      title,
      ...parts.filter((part) => part.type === "description" || part.type === "tag").map((part) => part.text),
      ...comments.slice(0, 5).map((part) => part.text)
    ],
    220
  );
  const topicText = topics.length ? `主题集中在${topics.slice(0, 3).join("、")}` : "主题暂不集中";
  const sentimentText =
    sentiment === "negative" ? "负面倾向明显" : sentiment === "positive" ? "正面反馈较多" : sentiment === "mixed" ? "正负反馈混合" : "情绪相对中性";

  return `${topicText}，${sentimentText}。${base}`;
}

function countOccurrences(content: string, word: string) {
  if (!word) return 0;
  return content.split(word).length - 1;
}
