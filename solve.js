/**
 * High-performance, zero-allocation drop-in replacement for csv-reader 1.0.0.
 *
 * Implements make.fun's broken-row CSV specification with single-pass scanning,
 * chunk-based slicing, and zero heap-closure allocations.
 *
 * SPDX-License-Identifier: MIT
 */

const COMMA = 1;
const LINE_BREAK = 2;
const END = 3;

class FastCsvParser {
  constructor() {
    this.text = "";
    this.len = 0;
    this.pos = 0;
    this.line = 1;
    this.recordLine = 1;
    this.recordRow = null;
    this.errors = [];
    this.rows = [];
    this.columns = null;
    this.width = -1;
    this.fieldEnded = 0;
    this.fieldAdded = 0;
  }

  error(code) {
    this.errors.push({ code, line: this.recordLine, row: this.recordRow });
  }

  readUnquoted(initialValue) {
    const text = this.text;
    const len = this.len;
    let pos = this.pos;
    let line = this.line;
    let value = initialValue;
    let added = 0;
    let start = pos;

    while (pos < len) {
      switch (text.charCodeAt(pos)) {
        case 44: { // ','
          const chunk = text.slice(start, pos);
          value = value.length > 0 ? value + chunk : chunk;
          added += pos - start;
          this.pos = pos + 1;
          this.line = line;
          this.fieldEnded = COMMA;
          this.fieldAdded = added;
          return value;
        }
        case 10: { // '\n'
          const chunk = text.slice(start, pos);
          value = value.length > 0 ? value + chunk : chunk;
          added += pos - start;
          this.pos = pos + 1;
          this.line = line + 1;
          this.fieldEnded = LINE_BREAK;
          this.fieldAdded = added;
          return value;
        }
        case 13: { // '\r'
          if (pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
            const chunk = text.slice(start, pos);
            value = value.length > 0 ? value + chunk : chunk;
            added += pos - start;
            this.pos = pos + 2;
            this.line = line + 1;
            this.fieldEnded = LINE_BREAK;
            this.fieldAdded = added;
            return value;
          }
          this.error("stray_cr");
          const chunk = text.slice(start, pos);
          value = value.length > 0 ? value + chunk : chunk;
          added += pos - start;
          pos++;
          start = pos;
          continue;
        }
        default:
          pos++;
      }
    }
    const chunk = text.slice(start, pos);
    value = value.length > 0 ? value + chunk : chunk;
    added += pos - start;
    this.pos = pos;
    this.line = line;
    this.fieldEnded = END;
    this.fieldAdded = added;
    return value;
  }

  readQuoted() {
    const text = this.text;
    const len = this.len;
    const open = this.pos;
    const openLine = this.line;
    let pos = open + 1;
    let line = openLine;
    let value = "";
    let closed = false;
    let start = pos;

    while (pos < len) {
      switch (text.charCodeAt(pos)) {
        case 34: { // '"'
          if (pos + 1 < len && text.charCodeAt(pos + 1) === 34) {
            const chunk = text.slice(start, pos);
            value = value.length > 0 ? value + chunk + "\"" : chunk + "\"";
            pos += 2;
            start = pos;
            continue;
          }
          const chunk = text.slice(start, pos);
          value = value.length > 0 ? value + chunk : chunk;
          pos++;
          closed = true;
          break;
        }
        case 13: { // '\r'
          const chunk = text.slice(start, pos);
          value = value.length > 0 ? value + chunk + "\n" : chunk + "\n";
          line++;
          pos += (pos + 1 < len && text.charCodeAt(pos + 1) === 10) ? 2 : 1;
          start = pos;
          continue;
        }
        case 10: { // '\n'
          line++;
          pos++;
          continue;
        }
        default:
          pos++;
          continue;
      }
      break;
    }

    if (!closed) {
      this.pos = open + 1;
      this.line = openLine;
      this.error("unterminated_quote");
      return this.readUnquoted("\"");
    }

    this.pos = pos;
    this.line = line;

    if (pos >= len) {
      this.fieldEnded = END;
      this.fieldAdded = 0;
      return value;
    }

    const code = text.charCodeAt(pos);
    if (code === 44) {
      this.pos = pos + 1;
      this.fieldEnded = COMMA;
      this.fieldAdded = 0;
      return value;
    }
    if (code === 10) {
      this.pos = pos + 1;
      this.line = line + 1;
      this.fieldEnded = LINE_BREAK;
      this.fieldAdded = 0;
      return value;
    }
    if (code === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      this.pos = pos + 2;
      this.line = line + 1;
      this.fieldEnded = LINE_BREAK;
      this.fieldAdded = 0;
      return value;
    }

    const junkVal = this.readUnquoted(value);
    if (this.fieldAdded > 0) this.error("quote_junk");
    return junkVal;
  }

  parse(input) {
    const text = String(input.text);
    const header = input.header === true;
    const len = text.length;

    this.text = text;
    this.len = len;
    this.errors = [];
    this.rows = [];
    this.columns = null;
    this.width = -1;

    let pos = 0;
    let line = 1;
    if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;
    this.pos = pos;
    this.line = line;

    while (true) {
      pos = this.pos;
      line = this.line;
      while (pos < len) {
        const code = text.charCodeAt(pos);
        if (code === 10) {
          pos++;
          line++;
        } else if (code === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line++;
        } else {
          break;
        }
      }
      this.pos = pos;
      this.line = line;
      if (pos >= len) break;

      this.recordLine = line;
      this.recordRow = header && this.columns === null ? null : this.rows.length;
      const fields = [];
      let quoted;
      do {
        quoted = text.charCodeAt(this.pos) === 34;
        const val = quoted ? this.readQuoted() : this.readUnquoted("");
        fields.push(val);
      } while (this.fieldEnded === COMMA);

      if (fields.length === 1 && fields[0] === "" && !quoted) continue;

      if (this.width < 0) this.width = fields.length;
      if (header && this.columns === null) {
        this.columns = fields;
        continue;
      }
      if (fields.length < this.width) {
        this.errors.push({ code: "short_row", line: this.recordLine, row: this.recordRow, fields: fields.length });
        while (fields.length < this.width) fields.push("");
      } else if (fields.length > this.width) {
        this.errors.push({ code: "long_row", line: this.recordLine, row: this.recordRow, extra: fields.splice(this.width) });
      }
      this.rows.push(fields);
    }

    return {
      columns: header ? (this.columns ?? []) : null,
      rows: this.rows,
      errors: this.errors,
    };
  }
}

/** Entrypoint conforming to csv-reader 1.0.0 */
export function run(input) {
  const parser = new FastCsvParser();
  return parser.parse(input);
}
