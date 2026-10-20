package com.iptvplayer.core;

import java.io.IOException;
import java.io.Reader;

/**
 * Small, lenient streaming JSON pull parser (no allocations per token beyond the
 * strings it returns). Designed for very large Xtream Codes API responses.
 */
public final class JsonPull {
    public static final int NONE = 0, BEGIN_OBJECT = 1, END_OBJECT = 2, BEGIN_ARRAY = 3, END_ARRAY = 4,
            NAME = 5, STRING = 6, NUMBER = 7, BOOLEAN = 8, NULL = 9, END = 10;

    private static final int EMPTY_DOCUMENT = 1, NONEMPTY_DOCUMENT = 2, EMPTY_ARRAY = 3, NONEMPTY_ARRAY = 4,
            EMPTY_OBJECT = 5, DANGLING_NAME = 6, NONEMPTY_OBJECT = 7;

    private final Reader in;
    private final char[] buf = new char[32768];
    private int pos, limit;
    private int[] stack = new int[32];
    private int depth;
    private int peeked = NONE;
    private String peekedString;
    private final StringBuilder sb = new StringBuilder(64);
    private long consumed;

    public JsonPull(Reader in) {
        this.in = in;
        stack[depth++] = EMPTY_DOCUMENT;
    }

    /** Characters consumed so far (for progress reporting). */
    public long consumed() { return consumed + pos; }

    private boolean fill() throws IOException {
        consumed += pos;
        pos = 0;
        int n = in.read(buf, 0, buf.length);
        limit = n > 0 ? n : 0;
        return n > 0;
    }

    private int nextNonWs() throws IOException {
        while (true) {
            if (pos >= limit && !fill()) return -1;
            char c = buf[pos++];
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '﻿') continue;
            return c;
        }
    }

    private IOException err(String m) {
        return new IOException("Invalid JSON: " + m + " at char " + consumed());
    }

    private void push(int s) {
        if (depth == stack.length) {
            int[] n = new int[depth * 2];
            System.arraycopy(stack, 0, n, 0, depth);
            stack = n;
        }
        stack[depth++] = s;
    }

    public int peek() throws IOException {
        if (peeked != NONE) return peeked;
        int top = stack[depth - 1];
        int c;
        if (top == EMPTY_ARRAY) {
            stack[depth - 1] = NONEMPTY_ARRAY;
        } else if (top == NONEMPTY_ARRAY) {
            c = nextNonWs();
            if (c == ']') return peeked = END_ARRAY;
            if (c != ',') throw err("expected , or ]");
        } else if (top == EMPTY_OBJECT || top == NONEMPTY_OBJECT) {
            stack[depth - 1] = DANGLING_NAME;
            if (top == NONEMPTY_OBJECT) {
                c = nextNonWs();
                if (c == '}') return peeked = END_OBJECT;
                if (c != ',') throw err("expected , or }");
            }
            c = nextNonWs();
            if (c == '"') {
                peekedString = readString();
                return peeked = NAME;
            }
            if (c == '}') return peeked = END_OBJECT; // also tolerates a trailing comma
            if (c == -1) throw err("unexpected end in object");
            pos--;
            peekedString = readLiteral(); // lenient unquoted name
            return peeked = NAME;
        } else if (top == DANGLING_NAME) {
            stack[depth - 1] = NONEMPTY_OBJECT;
            c = nextNonWs();
            if (c != ':') throw err("expected :");
        } else if (top == EMPTY_DOCUMENT) {
            stack[depth - 1] = NONEMPTY_DOCUMENT;
        } else if (top == NONEMPTY_DOCUMENT) {
            c = nextNonWs();
            if (c == -1) return peeked = END;
            pos--;
        }
        c = nextNonWs();
        switch (c) {
            case -1:
                if (top == EMPTY_DOCUMENT) throw err("empty response");
                return peeked = END;
            case ']':
                if (top == EMPTY_ARRAY || top == NONEMPTY_ARRAY) return peeked = END_ARRAY;
                throw err("unexpected ]");
            case '{':
                return peeked = BEGIN_OBJECT;
            case '[':
                return peeked = BEGIN_ARRAY;
            case '"':
                peekedString = readString();
                return peeked = STRING;
            case '\'':
                throw err("unexpected '");
            default:
                pos--;
                String lit = readLiteral();
                if (lit.length() == 0) throw err("unexpected character '" + (char) c + "'");
                if (lit.equals("true") || lit.equals("false")) { peekedString = lit; return peeked = BOOLEAN; }
                if (lit.equals("null")) { peekedString = null; return peeked = NULL; }
                char f = lit.charAt(0);
                if ((f >= '0' && f <= '9') || f == '-' || f == '+' || f == '.') { peekedString = lit; return peeked = NUMBER; }
                throw err("unexpected token " + (lit.length() > 20 ? lit.substring(0, 20) : lit));
        }
    }

    private String readLiteral() throws IOException {
        sb.setLength(0);
        while (true) {
            if (pos >= limit && !fill()) break;
            char c = buf[pos];
            if (c == ',' || c == '}' || c == ']' || c == ':' || c == ' ' || c == '\n' || c == '\r' || c == '\t'
                    || c == '{' || c == '[' || c == '"') break;
            sb.append(c);
            pos++;
        }
        return sb.toString();
    }

    private String readString() throws IOException {
        sb.setLength(0);
        while (true) {
            int start = pos;
            while (pos < limit) {
                char c = buf[pos++];
                if (c == '"') {
                    if (sb.length() == 0) return new String(buf, start, pos - start - 1);
                    sb.append(buf, start, pos - start - 1);
                    return sb.toString();
                }
                if (c == '\\') {
                    sb.append(buf, start, pos - start - 1);
                    readEscape();
                    start = pos;
                }
            }
            sb.append(buf, start, pos - start);
            if (!fill()) throw err("unterminated string");
        }
    }

    private int readChar() throws IOException {
        if (pos >= limit && !fill()) throw err("unterminated escape");
        return buf[pos++];
    }

    private void readEscape() throws IOException {
        int c = readChar();
        switch (c) {
            case 'n': sb.append('\n'); break;
            case 't': sb.append('\t'); break;
            case 'r': sb.append('\r'); break;
            case 'b': sb.append('\b'); break;
            case 'f': sb.append('\f'); break;
            case 'u': {
                int v = 0;
                for (int i = 0; i < 4; i++) {
                    int h = readChar();
                    int d = Character.digit(h, 16);
                    if (d < 0) throw err("bad unicode escape");
                    v = (v << 4) | d;
                }
                sb.append((char) v);
                break;
            }
            default: sb.append((char) c); // \" \\ \/ and lenient others
        }
    }

    public void beginObject() throws IOException {
        if (peek() != BEGIN_OBJECT) throw err("expected object");
        peeked = NONE;
        push(EMPTY_OBJECT);
    }

    public void endObject() throws IOException {
        if (peek() != END_OBJECT) throw err("expected end of object");
        peeked = NONE;
        depth--;
    }

    public void beginArray() throws IOException {
        if (peek() != BEGIN_ARRAY) throw err("expected array");
        peeked = NONE;
        push(EMPTY_ARRAY);
    }

    public void endArray() throws IOException {
        if (peek() != END_ARRAY) throw err("expected end of array");
        peeked = NONE;
        depth--;
    }

    public boolean hasNext() throws IOException {
        int p = peek();
        return p != END_OBJECT && p != END_ARRAY && p != END;
    }

    public String nextName() throws IOException {
        if (peek() != NAME) throw err("expected name");
        peeked = NONE;
        return peekedString;
    }

    /** Returns string/number/boolean as text; null for JSON null. */
    public String nextString() throws IOException {
        int p = peek();
        if (p == STRING || p == NUMBER || p == BOOLEAN || p == NULL) {
            peeked = NONE;
            return peekedString;
        }
        throw err("expected value");
    }

    /**
     * Reads any value as a flat string: primitives as text, null as "",
     * arrays as their first primitive element, objects skipped as "".
     */
    public String nextFlat() throws IOException {
        int p = peek();
        if (p == BEGIN_ARRAY) {
            beginArray();
            String first = "";
            boolean got = false;
            while (hasNext()) {
                int q = peek();
                if (!got && (q == STRING || q == NUMBER || q == BOOLEAN)) {
                    first = nextString();
                    got = first != null && first.length() > 0;
                    if (first == null) first = "";
                } else skipValue();
            }
            endArray();
            return first;
        }
        if (p == BEGIN_OBJECT) {
            skipValue();
            return "";
        }
        String s = nextString();
        return s == null ? "" : s;
    }

    public void skipValue() throws IOException {
        int count = 0;
        do {
            int p = peek();
            if (p == BEGIN_ARRAY) { beginArray(); count++; }
            else if (p == BEGIN_OBJECT) { beginObject(); count++; }
            else if (p == END_ARRAY) { endArray(); count--; }
            else if (p == END_OBJECT) { endObject(); count--; }
            else if (p == END) { return; }
            else { peeked = NONE; }
        } while (count > 0);
    }

    /**
     * Positions the reader inside a list of records. Accepts a top level array,
     * or an object whose values are the records (some panels return maps).
     * Returns true if the container is an object (caller must skip names).
     */
    public boolean beginRecords() throws IOException {
        int p = peek();
        if (p == BEGIN_ARRAY) { beginArray(); return false; }
        if (p == BEGIN_OBJECT) { beginObject(); return true; }
        throw err("expected a list");
    }

    public void endRecords(boolean isObject) throws IOException {
        if (isObject) endObject(); else endArray();
    }
}
