import type { SearchOptions, Video, VideoKind, Watch } from "../types.js";

export interface QueryEvaluation {
  matched: boolean;
  score: number;
}

export interface CompiledQuery {
  error?: string;
  hasTextClauses: boolean;
  evaluate(video: Video, watch: Watch, accountLabel: string): QueryEvaluation;
}

type FilterPredicate = (video: Video, watch: Watch, accountLabel: string) => boolean;

interface FieldTokens {
  titleLower: string;
  titleWords: string[];
  titleStems: string[];
  bodyLower: string;
  bodyWords: string[];
  bodyStems: string[];
}

interface TextClause {
  kind: "term" | "phrase" | "regex";
  value: string;
  regex?: RegExp;
}

type RawTokenKind = "word" | "lparen" | "rparen" | "or";

interface RawToken {
  kind: RawTokenKind;
  raw: string;
}

type ExprNode =
  | { type: "clause"; clause: TextClause }
  | { type: "or"; branches: ExprNode[] }
  | { type: "seq"; items: ExprNode[] };

function parseRegexLiteral(raw: string): { pattern: string; flags: string } | null {
  if (!raw.startsWith("/") || raw.length < 2) {
    return null;
  }
  let escaped = false;
  for (let i = 1; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "/") {
      const pattern = raw.slice(1, i);
      const flags = raw.slice(i + 1);
      if (/^[a-z]*$/i.test(flags)) {
        return { pattern, flags };
      }
      return null;
    }
  }
  return null;
}

function buildSafeRegex(pattern: string, flags: string): RegExp {
  const safeFlags = flags.replace(/[gy]/g, "");
  return new RegExp(pattern, safeFlags);
}

function stripOuterQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeKind(raw: string): VideoKind | null {
  const lower = raw.trim().toLowerCase();
  if (lower === "video" || lower === "videos") {
    return "video";
  }
  if (lower === "short" || lower === "shorts") {
    return "short";
  }
  if (lower === "live" || lower === "lives") {
    return "live";
  }
  if (lower === "music") {
    return "music";
  }
  return null;
}

function parseLocalDateBoundary(raw: string, bound: "start" | "end"): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date =
    bound === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function stemWord(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) {
    return w;
  }

  if (w.endsWith("ies") && w.length > 4) {
    w = `${w.slice(0, -3)}y`;
  } else if (/(?:sh|ch|x|z|s)es$/.test(w) && w.length > 4) {
    w = w.slice(0, -2);
  } else if (
    w.endsWith("s") &&
    !w.endsWith("ss") &&
    !w.endsWith("us") &&
    !w.endsWith("is") &&
    w.length > 3
  ) {
    w = w.slice(0, -1);
  }

  let strippedSuffix = false;
  if (w.endsWith("ing") && w.length - 3 >= 3) {
    w = w.slice(0, -3);
    strippedSuffix = true;
  } else if (w.endsWith("ed") && w.length - 2 >= 3) {
    w = w.slice(0, -2);
    strippedSuffix = true;
  } else if (w.endsWith("er") && w.length - 2 >= 3) {
    w = w.slice(0, -2);
    strippedSuffix = true;
  }

  if (strippedSuffix) {
    w = w.replace(/([bcdfghjkmnprtvwxy])\1$/, "$1");
  }

  if (w.length >= 4 && /[bcdfghjklmnpqrstvwxz]e$/.test(w)) {
    w = w.slice(0, -1);
  }

  return w;
}

function extractFieldTokens(video: Video): FieldTokens {
  const titleLower = video.title.toLowerCase();
  const titleWords = tokenizeWords(video.title);
  const bodyRaw = `${video.channelName}\n${video.descriptionSnippet ?? ""}`;
  const bodyLower = bodyRaw.toLowerCase();
  const bodyWords = tokenizeWords(bodyRaw);
  return {
    titleLower,
    titleWords,
    titleStems: titleWords.map(stemWord),
    bodyLower,
    bodyWords,
    bodyStems: bodyWords.map(stemWord)
  };
}

function matchesCollapsedSpan(targetCollapsed: string, words: string[]): boolean {
  if (!targetCollapsed) {
    return false;
  }
  for (let i = 0; i < words.length; i += 1) {
    let combined = "";
    for (let j = i; j < words.length && combined.length < targetCollapsed.length; j += 1) {
      combined += words[j] ?? "";
      if (combined === targetCollapsed) {
        return true;
      }
    }
  }
  return false;
}

function scoreTermInField(
  termLower: string,
  termStem: string,
  words: string[],
  stems: string[]
): number {
  if (words.includes(termLower) || stems.includes(termStem)) {
    return 1.0;
  }
  if (matchesCollapsedSpan(termLower, words)) {
    return 0.85;
  }
  if (termLower.length >= 4 && words.some((w) => w.startsWith(termLower))) {
    return 0.7;
  }
  return 0;
}

function matchesStemSequence(phraseStems: string[], fieldStems: string[]): boolean {
  if (phraseStems.length === 0 || fieldStems.length < phraseStems.length) {
    return false;
  }
  for (let i = 0; i <= fieldStems.length - phraseStems.length; i += 1) {
    let allMatch = true;
    for (let j = 0; j < phraseStems.length; j += 1) {
      if (fieldStems[i + j] !== phraseStems[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return true;
    }
  }
  return false;
}

function buildInitialism(words: string[]): string | null {
  if (words.length < 3) {
    return null;
  }
  const letters = words.map((w) => w[0] ?? "").join("").toLowerCase();
  return /^[a-z0-9]{3,}$/.test(letters) ? letters : null;
}

function scorePhraseInField(
  phraseLower: string,
  phraseWords: string[],
  phraseStems: string[],
  fieldLower: string,
  fieldWords: string[],
  fieldStems: string[]
): number {
  if (fieldLower.includes(phraseLower)) {
    return 1.0;
  }
  if (phraseWords.length >= 2) {
    const collapsed = phraseWords.join("");
    if (matchesCollapsedSpan(collapsed, fieldWords)) {
      return 0.85;
    }
    if (matchesStemSequence(phraseStems, fieldStems)) {
      return 0.85;
    }
  }
  const initialism = buildInitialism(phraseWords);
  if (initialism && fieldWords.includes(initialism)) {
    return 0.6;
  }
  return 0;
}

function scorePhrase(
  phraseLower: string,
  phraseWords: string[],
  fields: FieldTokens
): number {
  const phraseStems = phraseWords.map(stemWord);
  const titleScore = scorePhraseInField(
    phraseLower,
    phraseWords,
    phraseStems,
    fields.titleLower,
    fields.titleWords,
    fields.titleStems
  );
  const bodyScore = scorePhraseInField(
    phraseLower,
    phraseWords,
    phraseStems,
    fields.bodyLower,
    fields.bodyWords,
    fields.bodyStems
  );
  return titleScore * 2.0 + bodyScore * 1.0;
}

function scoreClauseBroad(clause: TextClause, video: Video, fields: FieldTokens): number {
  if (clause.kind === "regex" && clause.regex) {
    if (clause.regex.test(video.title)) {
      return 2.0;
    }
    const body = `${video.channelName}\n${video.descriptionSnippet ?? ""}`;
    return clause.regex.test(body) ? 1.0 : 0;
  }

  if (clause.kind === "phrase") {
    return scorePhrase(clause.value.toLowerCase(), tokenizeWords(clause.value), fields);
  }

  const termWords = tokenizeWords(clause.value);
  if (termWords.length === 0) {
    return 0;
  }
  if (termWords.length >= 2) {
    return scorePhrase(termWords.join(" "), termWords, fields);
  }

  const singleWord = termWords[0] ?? "";
  const termStem = stemWord(singleWord);
  const titleScore = scoreTermInField(singleWord, termStem, fields.titleWords, fields.titleStems);
  const bodyScore = scoreTermInField(singleWord, termStem, fields.bodyWords, fields.bodyStems);
  return titleScore * 2.0 + bodyScore * 1.0;
}

function matchesClauseStrict(clause: TextClause, video: Video): boolean {
  const haystack = `${video.title}\n${video.channelName}\n${video.descriptionSnippet ?? ""}`;
  if (clause.kind === "regex" && clause.regex) {
    return clause.regex.test(haystack);
  }
  return haystack.toLowerCase().includes(clause.value.toLowerCase());
}

function tokenizeQuery(query: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;

  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i] ?? "")) {
      i += 1;
    }
    if (i >= query.length) {
      break;
    }

    const ch0 = query[i] ?? "";
    if (ch0 === "(") {
      tokens.push({ kind: "lparen", raw: "(" });
      i += 1;
      continue;
    }
    if (ch0 === ")") {
      tokens.push({ kind: "rparen", raw: ")" });
      i += 1;
      continue;
    }
    if (ch0 === "|") {
      tokens.push({ kind: "or", raw: "|" });
      i += 1;
      continue;
    }

    const start = i;
    const isNegatedRegex = query.slice(i, i + 2) === "-/";
    const isRegex = ch0 === "/" || isNegatedRegex;
    if (isRegex) {
      const slashStart = isNegatedRegex ? i + 1 : i;
      let escaped = false;
      let j = slashStart + 1;
      let closed = false;
      while (j < query.length) {
        const ch = query[j];
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === "/") {
          j += 1;
          while (j < query.length && /[a-z]/i.test(query[j] ?? "")) {
            j += 1;
          }
          const after = query[j] ?? "";
          if (j >= query.length || /\s|[)|]/.test(after)) {
            closed = true;
            break;
          }
        }
        j += 1;
      }
      if (closed) {
        tokens.push({ kind: "word", raw: query.slice(start, j) });
        i = j;
        continue;
      }
    }

    let current = "";
    let inQuotes = false;
    while (i < query.length) {
      const ch = query[i] ?? "";
      if (ch === '"') {
        inQuotes = !inQuotes;
        current += ch;
        i += 1;
        continue;
      }
      if (!inQuotes && (/\s/.test(ch) || ch === "(" || ch === ")" || ch === "|")) {
        break;
      }
      current += ch;
      i += 1;
    }
    if (current.length > 0) {
      if (current === "OR") {
        tokens.push({ kind: "or", raw: current });
      } else {
        tokens.push({ kind: "word", raw: current });
      }
    }
  }

  return tokens;
}

type AstToken =
  | { type: "clause"; clause: TextClause }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "or" };

function parseExpressionAst(tokens: AstToken[]): ExprNode | null {
  let pos = 0;

  const peek = (): AstToken | undefined => tokens[pos];
  const consume = (): AstToken | undefined => {
    const tok = tokens[pos];
    pos += 1;
    return tok;
  };

  function parseOr(): ExprNode | null {
    const first = parseSeq();
    const branches: ExprNode[] = first ? [first] : [];

    while (peek()?.type === "or") {
      consume();
      const next = parseSeq();
      if (next) {
        branches.push(next);
      }
    }

    if (branches.length === 0) {
      return null;
    }
    if (branches.length === 1) {
      return branches[0] ?? null;
    }
    return { type: "or", branches };
  }

  function parseSeq(): ExprNode | null {
    const items: ExprNode[] = [];
    while (pos < tokens.length) {
      const next = peek();
      if (!next || next.type === "or" || next.type === "rparen") {
        break;
      }
      const primary = parsePrimary();
      if (primary) {
        items.push(primary);
      }
    }
    if (items.length === 0) {
      return null;
    }
    if (items.length === 1) {
      return items[0] ?? null;
    }
    return { type: "seq", items };
  }

  function parsePrimary(): ExprNode | null {
    const tok = peek();
    if (!tok) {
      return null;
    }
    if (tok.type === "lparen") {
      consume();
      const inner = parseOr();
      if (peek()?.type === "rparen") {
        consume();
      }
      return inner;
    }
    if (tok.type === "clause") {
      consume();
      return { type: "clause", clause: tok.clause };
    }
    consume();
    return null;
  }

  const root = parseOr();
  // Collect any stray tokens after an unmatched ')'
  const extraItems: ExprNode[] = root ? [root] : [];
  while (pos < tokens.length) {
    if (peek()?.type === "rparen") {
      consume();
      continue;
    }
    const rest = parseOr();
    if (rest) {
      extraItems.push(rest);
    } else {
      consume();
    }
  }

  if (extraItems.length === 0) {
    return null;
  }
  if (extraItems.length === 1) {
    return extraItems[0] ?? null;
  }
  return { type: "seq", items: extraItems };
}

function evaluateAstStrict(node: ExprNode, video: Video): boolean {
  if (node.type === "clause") {
    return matchesClauseStrict(node.clause, video);
  }
  if (node.type === "or") {
    return node.branches.some((branch) => evaluateAstStrict(branch, video));
  }
  return node.items.every((item) => evaluateAstStrict(item, video));
}

function evaluateAstBroad(
  node: ExprNode,
  video: Video,
  fields: FieldTokens
): QueryEvaluation {
  if (node.type === "clause") {
    const s = scoreClauseBroad(node.clause, video, fields);
    return { matched: s > 0, score: s };
  }

  if (node.type === "or") {
    let matchedCount = 0;
    let bestScore = 0;
    for (const branch of node.branches) {
      const res = evaluateAstBroad(branch, video, fields);
      if (res.matched) {
        matchedCount += 1;
        if (res.score > bestScore) {
          bestScore = res.score;
        }
      }
    }
    if (matchedCount === 0) {
      return { matched: false, score: 0 };
    }
    return {
      matched: true,
      score: bestScore + (matchedCount - 1) * 5
    };
  }

  let matchedCount = 0;
  let sumScore = 0;
  for (const item of node.items) {
    const res = evaluateAstBroad(item, video, fields);
    if (res.matched) {
      matchedCount += 1;
      sumScore += res.score;
    }
  }
  if (matchedCount === 0) {
    return { matched: false, score: 0 };
  }
  return {
    matched: true,
    score: matchedCount * 10 + sumScore
  };
}

export function compileSearchQuery(query: string, options?: SearchOptions): CompiledQuery {
  const filters: FilterPredicate[] = [];
  const strict = Boolean(options?.strict);

  if (options?.accountId && options.accountId.trim().length > 0) {
    const targetAccountId = options.accountId.trim();
    filters.push((_video, watch) => watch.accountId === targetAccountId);
  }

  if (options?.kind) {
    const targetKind = options.kind;
    filters.push((video) => video.kind === targetKind);
  }

  if (options?.afterDate && options.afterDate.trim().length > 0) {
    const afterMs = parseLocalDateBoundary(options.afterDate, "start");
    if (afterMs === null) {
      return {
        error: `Invalid after date "${options.afterDate}" (expected YYYY-MM-DD)`,
        hasTextClauses: false,
        evaluate: () => ({ matched: false, score: 0 })
      };
    }
    filters.push((_video, watch) => watch.watchedAt >= afterMs);
  }

  if (options?.beforeDate && options.beforeDate.trim().length > 0) {
    const beforeMs = parseLocalDateBoundary(options.beforeDate, "end");
    if (beforeMs === null) {
      return {
        error: `Invalid before date "${options.beforeDate}" (expected YYYY-MM-DD)`,
        hasTextClauses: false,
        evaluate: () => ({ matched: false, score: 0 })
      };
    }
    filters.push((_video, watch) => watch.watchedAt <= beforeMs);
  }

  const trimmed = query.trim();

  if (options?.regex) {
    let regexClause: RegExp | null = null;
    if (trimmed.length > 0) {
      try {
        const literal = parseRegexLiteral(trimmed);
        regexClause = literal
          ? buildSafeRegex(literal.pattern, literal.flags || "i")
          : buildSafeRegex(trimmed, "i");
      } catch (err) {
        return {
          error: `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
          hasTextClauses: true,
          evaluate: () => ({ matched: false, score: 0 })
        };
      }
    }
    return {
      hasTextClauses: regexClause !== null,
      evaluate(video, watch, accountLabel) {
        if (!filters.every((pred) => pred(video, watch, accountLabel))) {
          return { matched: false, score: 0 };
        }
        if (!regexClause) {
          return { matched: true, score: 0 };
        }
        const haystack = `${video.title}\n${video.channelName}\n${video.descriptionSnippet ?? ""}`;
        const hit = regexClause.test(haystack);
        return { matched: hit, score: hit ? 1 : 0 };
      }
    };
  }

  const rawTokens = tokenizeQuery(trimmed);
  const astTokens: AstToken[] = [];
  const plainTerms: TextClause[] = [];
  const negatedClauses: TextClause[] = [];
  let sawOperatorsOrParens = false;
  let hasPositiveClauses = false;

  for (const tok of rawTokens) {
    if (tok.kind === "lparen") {
      sawOperatorsOrParens = true;
      astTokens.push({ type: "lparen" });
      continue;
    }
    if (tok.kind === "rparen") {
      sawOperatorsOrParens = true;
      astTokens.push({ type: "rparen" });
      continue;
    }
    if (tok.kind === "or") {
      sawOperatorsOrParens = true;
      astTokens.push({ type: "or" });
      continue;
    }

    const token = tok.raw;
    const negated = token.startsWith("-") && token.length > 1;
    const raw = negated ? token.slice(1) : token;

    const regexLit = parseRegexLiteral(raw);
    if (regexLit) {
      try {
        const clause: TextClause = {
          kind: "regex",
          value: raw,
          regex: buildSafeRegex(regexLit.pattern, regexLit.flags)
        };
        if (negated) {
          negatedClauses.push(clause);
        } else {
          hasPositiveClauses = true;
          astTokens.push({ type: "clause", clause });
        }
      } catch (err) {
        return {
          error: `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
          hasTextClauses: false,
          evaluate: () => ({ matched: false, score: 0 })
        };
      }
      continue;
    }

    const colonIdx = raw.indexOf(":");
    if (colonIdx > 0 && !raw.startsWith('"')) {
      const prefix = raw.slice(0, colonIdx).toLowerCase();
      const rawValue = stripOuterQuotes(raw.slice(colonIdx + 1));

      if (prefix === "channel" && rawValue.length > 0) {
        const needle = rawValue.toLowerCase();
        filters.push((video) => {
          const hit = video.channelName.toLowerCase().includes(needle);
          return negated ? !hit : hit;
        });
        continue;
      }

      if (prefix === "account" && rawValue.length > 0) {
        const needleLower = rawValue.toLowerCase();
        filters.push((_video, watch, accountLabel) => {
          const hit =
            accountLabel.toLowerCase() === needleLower || watch.accountId === rawValue;
          return negated ? !hit : hit;
        });
        continue;
      }

      if (prefix === "type" && rawValue.length > 0) {
        const kind = normalizeKind(rawValue);
        if (!kind) {
          return {
            error: `Unknown type filter "${rawValue}"`,
            hasTextClauses: false,
            evaluate: () => ({ matched: false, score: 0 })
          };
        }
        filters.push((video) => {
          const hit = video.kind === kind;
          return negated ? !hit : hit;
        });
        continue;
      }

      if (prefix === "after" && !negated && rawValue.length > 0) {
        const afterMs = parseLocalDateBoundary(rawValue, "start");
        if (afterMs === null) {
          return {
            error: `Invalid after date "${rawValue}" (expected YYYY-MM-DD)`,
            hasTextClauses: false,
            evaluate: () => ({ matched: false, score: 0 })
          };
        }
        filters.push((_video, watch) => watch.watchedAt >= afterMs);
        continue;
      }

      if (prefix === "before" && !negated && rawValue.length > 0) {
        const beforeMs = parseLocalDateBoundary(rawValue, "end");
        if (beforeMs === null) {
          return {
            error: `Invalid before date "${rawValue}" (expected YYYY-MM-DD)`,
            hasTextClauses: false,
            evaluate: () => ({ matched: false, score: 0 })
          };
        }
        filters.push((_video, watch) => watch.watchedAt <= beforeMs);
        continue;
      }
    }

    const isQuoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2;
    const unquoted = stripOuterQuotes(raw);
    if (unquoted.length > 0) {
      const clause: TextClause = {
        kind: isQuoted ? "phrase" : "term",
        value: unquoted
      };
      if (negated) {
        negatedClauses.push(clause);
      } else {
        hasPositiveClauses = true;
        if (clause.kind === "term") {
          plainTerms.push(clause);
        } else {
          sawOperatorsOrParens = true;
        }
        astTokens.push({ type: "clause", clause });
      }
    }
  }

  const exprRoot = parseExpressionAst(astTokens);
  const fallbackInitialism =
    !strict &&
    !sawOperatorsOrParens &&
    plainTerms.length >= 3 &&
    plainTerms.length <= 5
      ? buildInitialism(plainTerms.map((t) => tokenizeWords(t.value)[0] ?? t.value))
      : null;

  return {
    hasTextClauses: hasPositiveClauses && exprRoot !== null,
    evaluate(video, watch, accountLabel) {
      if (!filters.every((pred) => pred(video, watch, accountLabel))) {
        return { matched: false, score: 0 };
      }

      if (strict) {
        for (const neg of negatedClauses) {
          if (matchesClauseStrict(neg, video)) {
            return { matched: false, score: 0 };
          }
        }
        if (!exprRoot) {
          return { matched: true, score: 0 };
        }
        const hit = evaluateAstStrict(exprRoot, video);
        return { matched: hit, score: hit ? 1 : 0 };
      }

      const fields =
        exprRoot !== null || negatedClauses.length > 0 ? extractFieldTokens(video) : null;

      if (fields) {
        for (const neg of negatedClauses) {
          if (scoreClauseBroad(neg, video, fields) > 0) {
            return { matched: false, score: 0 };
          }
        }
      }

      if (!exprRoot || !fields) {
        return { matched: true, score: 0 };
      }

      const res = evaluateAstBroad(exprRoot, video, fields);
      let { matched, score } = res;

      if (fallbackInitialism) {
        const inTitle = fields.titleWords.includes(fallbackInitialism) ? 1.2 : 0;
        const inBody = fields.bodyWords.includes(fallbackInitialism) ? 0.6 : 0;
        const initScore = inTitle + inBody;
        if (initScore > 0) {
          if (!matched) {
            matched = true;
            score = 10 + initScore;
          } else {
            score += initScore;
          }
        }
      }

      return { matched, score };
    }
  };
}
