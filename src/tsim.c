// tsim: fast simulator + classifier for multi-colour Langton's ants and turmites.
//
// Rules:
//   "RL", "LLRR", "RLNU..."      n-colour ant (Turk/Propp notation). Char i = turn on colour i,
//                                  then the cell becomes colour (i+1) mod n.
//   "{{{1,2,0},{0,8,0}}}"        Golly / Ed Pegg turmite notation: per state, per colour
//                                  {write, turn, next}; turn 1=none 2=right 4=u-turn 8=left.
//
// Usage:
//   tsim run   <rule> <maxsteps> [-g grid] [-d dump.raw] [-t dumpat]
//   tsim batch <maxsteps> [-g grid]          (rules on stdin, one per line; JSON lines out)
//
// Highway detection: every step appends a symbol (colour read, state, new heading) to a log.
// The longest periodic tail of that log is found with the prefix function of the reversed
// tail. A tail repeating >= MINREP times with non-zero net displacement per period is a
// highway; onset is extended backwards exactly through the full log.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <math.h>

#define MAXS 4
#define MAXC 16
#define MINREP 6
#define MINTAIL 20000

typedef struct { uint8_t w, turn, ns; } Entry;
typedef struct { int S, C; Entry tab[MAXS][MAXC]; char text[512]; } Rule;

static const int DX[4] = {0, 1, 0, -1}, DY[4] = {-1, 0, 1, 0};

static int parse_rule(const char *s, Rule *r) {
    memset(r, 0, sizeof *r);
    snprintf(r->text, sizeof r->text, "%s", s);
    if (s[0] != '{') {
        int n = (int)strlen(s);
        if (n < 1 || n > MAXC) return -1;
        r->S = 1; r->C = n;
        for (int i = 0; i < n; i++) {
            int t;
            switch (s[i]) { case 'N': t = 0; break; case 'R': t = 1; break;
                            case 'U': t = 2; break; case 'L': t = 3; break; default: return -1; }
            r->tab[0][i] = (Entry){(uint8_t)((i + 1) % n), (uint8_t)t, 0};
        }
        return 0;
    }
    // Golly notation: depth 2 '{' opens a state, depth 3 '{' opens a {w,turn,next} triple.
    int depth = 0, st = -1, col = 0, nums[3], k = 0, C = -1;
    for (const char *p = s; *p; p++) {
        if (*p == '{') { depth++; if (depth == 2) { st++; col = 0; if (st >= MAXS) return -1; } if (depth == 3) k = 0; }
        else if (*p == '}') {
            if (depth == 3) {
                if (k != 3 || col >= MAXC) return -1;
                int t;
                switch (nums[1]) { case 1: t = 0; break; case 2: t = 1; break; case 4: t = 2; break; case 8: t = 3; break; default: return -1; }
                r->tab[st][col++] = (Entry){(uint8_t)nums[0], (uint8_t)t, (uint8_t)nums[2]};
            }
            if (depth == 2) { if (C < 0) C = col; else if (C != col) return -1; }
            depth--;
        } else if (*p >= '0' && *p <= '9') {
            int v = (int)strtol(p, (char **)&p, 10); p--;
            if (depth == 3 && k < 3) nums[k++] = v;
        }
    }
    r->S = st + 1; r->C = C;
    if (r->S < 1 || C < 1) return -1;
    for (int a = 0; a < r->S; a++) for (int b = 0; b < C; b++)
        if (r->tab[a][b].w >= C || r->tab[a][b].ns >= r->S) return -1;
    return 0;
}

typedef struct {
    long steps; int stop;            // 0 = maxsteps, 1 = hit border, 2 = highway confirmed early
    long period, onset; int hdx, hdy;
    int xmin, xmax, ymin, ymax;
    long bbox_half_area; int sym_hits, sym_checks;
    long nonzero; double secs, order;
} Result;

static uint8_t *grid; static int G;
static double order_ratio(const Result *res, int C);
static uint8_t *seqlog; static long seqcap;
static int32_t *pibuf; static long picap;

// Longest periodic tail of seqlog[0..n). Returns period (0 if none), sets *tail.
static long periodic_tail(long n, long W, long *tail) {
    if (W > n) W = n;
    if (W < MINTAIL) return 0;
    if (W > picap) { picap = W; pibuf = realloc(pibuf, sizeof(int32_t) * picap); }
    const uint8_t *e = seqlog + n - 1;   // r[i] = e[-i]
    pibuf[0] = 0;
    for (long i = 1; i < W; i++) {
        int32_t j = pibuf[i - 1];
        while (j > 0 && e[-i] != e[-j]) j = pibuf[j - 1];
        if (e[-i] == e[-j]) j++;
        pibuf[i] = j;
    }
    for (long m = W; m >= MINTAIL; m--) {
        long p = m - pibuf[m - 1];
        if (m >= MINREP * p) { *tail = m; return p; }
    }
    return 0;
}

static int is_symmetric(int x0, int x1, int y0, int y1) {
    int w = x1 - x0 + 1, h = y1 - y0 + 1;
    int ok[4] = {1, 1, 1, w == h};
    for (int y = y0; y <= y1 && (ok[0] | ok[1] | ok[2] | ok[3]); y++)
        for (int x = x0; x <= x1; x++) {
            uint8_t v = grid[(long)y * G + x];
            if (ok[0] && v != grid[(long)y * G + (x0 + x1 - x)]) ok[0] = 0;
            if (ok[1] && v != grid[(long)(y0 + y1 - y) * G + x]) ok[1] = 0;
            if (ok[3]) {   // main diagonal and anti-diagonal of the square bbox
                int u = x - x0, t = y - y0;
                if (v != grid[(long)(y0 + u) * G + (x0 + t)]) ok[3] = 0;
                if (ok[2] && v != grid[(long)(y0 + (w - 1 - u)) * G + (x0 + (w - 1 - t))]) ok[2] = 0;
            } else ok[2] = 0;
        }
    return ok[0] | ok[1] | ok[2] | ok[3];
}

static void simulate(const Rule *r, long maxsteps, long dumpat, Result *res) {
    clock_t c0 = clock();
    memset(res, 0, sizeof *res);
    if (maxsteps > seqcap) { seqcap = maxsteps; seqlog = realloc(seqlog, seqcap); }
    Entry tab[MAXS * MAXC];
    for (int a = 0; a < r->S; a++) for (int b = 0; b < r->C; b++) tab[a * MAXC + b] = r->tab[a][b];
    const long delta[4] = {-(long)G, 1, G, -1};
    int x = G / 2, y = G / 2, ox = x, oy = y, dir = 0, s = 0;
    long pos = (long)y * G + x;
    int xmin = x, xmax = x, ymin = y, ymax = y;
    long last_sym_area = 0, t = 0, check_every = 1L << 21, next_check = check_every;
    long half = maxsteps / 2; long half_area = -1;
    if (dumpat > 0 && dumpat < maxsteps) maxsteps = dumpat;
    res->stop = 0;
    for (; t < maxsteps; t++) {
        uint8_t c = grid[pos];
        Entry e = tab[s * MAXC + c];
        grid[pos] = e.w;
        dir = (dir + e.turn) & 3;
        seqlog[t] = (uint8_t)((c << 4) | (s << 2) | dir);
        s = e.ns;
        x += DX[dir]; y += DY[dir]; pos += delta[dir];
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        if (x <= 1 || y <= 1 || x >= G - 2 || y >= G - 2) { t++; res->stop = 1; break; }
        if (x == ox && y == oy) {
            long area = (long)(xmax - xmin + 1) * (ymax - ymin + 1);
            if (area >= 400 && area * 10 >= last_sym_area * 13 && res->sym_checks < 64) {
                last_sym_area = area; res->sym_checks++;
                if (is_symmetric(xmin, xmax, ymin, ymax)) res->sym_hits++;
            }
        }
        if (t == half) half_area = (long)(xmax - xmin + 1) * (ymax - ymin + 1);
        if (t + 1 == next_check) {
            next_check += check_every;
            long tail; long p = periodic_tail(t + 1, check_every, &tail);
            if (p && tail >= 20 * p && tail >= 100000) {
                int ddx = 0, ddy = 0;
                for (long i = t + 1 - p; i <= t; i++) { ddx += DX[seqlog[i] & 3]; ddy += DY[seqlog[i] & 3]; }
                if (ddx || ddy) { t++; res->stop = 2; break; }
            }
        }
    }
    res->steps = t;
    res->xmin = xmin - G / 2; res->xmax = xmax - G / 2; res->ymin = ymin - G / 2; res->ymax = ymax - G / 2;
    res->bbox_half_area = half_area;
    long tail; long p = periodic_tail(t, 1L << 22, &tail);
    if (p) {
        long i = t - tail;
        while (i > 0 && seqlog[i - 1] == seqlog[i - 1 + p]) i--;
        res->period = p; res->onset = i;
        for (long k = t - p; k < t; k++) { res->hdx += DX[seqlog[k] & 3]; res->hdy += DY[seqlog[k] & 3]; }
    }
    long nz = 0;
    for (int yy = ymin; yy <= ymax; yy++) for (int xx = xmin; xx <= xmax; xx++) nz += grid[(long)yy * G + xx] != 0;
    res->nonzero = nz;
    res->order = res->period ? -1 : order_ratio(res, r->C);
    res->secs = (double)(clock() - c0) / CLOCKS_PER_SEC;
}

#include <math.h>
// Conditional entropy of a cell given its left, up and up-left neighbours, divided by the
// marginal entropy. ~0 for crystalline growth (filled triangles/squares), ~0.7 for chaos.
static double order_ratio(const Result *res, int C) {
    static uint32_t cnt[MAXC * MAXC * MAXC * MAXC], mar[MAXC], ctxn[MAXC * MAXC * MAXC];
    memset(cnt, 0, sizeof cnt); memset(mar, 0, sizeof mar); memset(ctxn, 0, sizeof ctxn);
    int x0 = res->xmin + G / 2, x1 = res->xmax + G / 2, y0 = res->ymin + G / 2, y1 = res->ymax + G / 2;
    double n = 0;
    for (int y = y0 + 1; y <= y1; y++) for (int x = x0 + 1; x <= x1; x++) {
        int c = grid[(long)y * G + x];
        int ctx = (grid[(long)y * G + x - 1] * MAXC + grid[(long)(y - 1) * G + x]) * MAXC + grid[(long)(y - 1) * G + x - 1];
        cnt[ctx * MAXC + c]++; ctxn[ctx]++; mar[c]++; n++;
    }
    if (n < 100) return -1;
    double hm = 0, hj = 0, hx = 0;
    for (int c = 0; c < C; c++) if (mar[c]) hm -= mar[c] / n * log2(mar[c] / n);
    for (long i = 0; i < MAXC * MAXC * MAXC * MAXC; i++) if (cnt[i]) hj -= cnt[i] / n * log2(cnt[i] / n);
    for (long i = 0; i < MAXC * MAXC * MAXC; i++) if (ctxn[i]) hx -= ctxn[i] / n * log2(ctxn[i] / n);
    return hm > 0 ? (hj - hx) / hm : 0;
}

static void clear_bbox(const Result *res) {
    for (int y = res->ymin + G / 2; y <= res->ymax + G / 2; y++)
        memset(grid + (long)y * G + res->xmin + G / 2, 0, res->xmax - res->xmin + 1);
}

static const char *classify(const Result *res, long maxsteps) {
    if (res->period && (res->hdx || res->hdy)) return "highway";
    if (res->period) return "cycle";
    long area = (long)(res->xmax - res->xmin + 1) * (res->ymax - res->ymin + 1);
    if (res->stop == 0 && res->bbox_half_area == area && res->steps >= maxsteps) return "stalled";
    if (res->sym_hits >= 3) return "symmetric";
    return res->order >= 0 && res->order < 0.5 ? "ordered" : "chaotic";
}

static void print_json(const Rule *r, const Result *res, long maxsteps) {
    const char *why[3] = {"maxsteps", "border", "highway"};
    printf("{\"rule\":\"%s\",\"S\":%d,\"C\":%d,\"class\":\"%s\",\"steps\":%ld,\"stop\":\"%s\","
           "\"period\":%ld,\"onset\":%ld,\"hdx\":%d,\"hdy\":%d,\"w\":%d,\"h\":%d,\"x0\":%d,\"y0\":%d,"
           "\"nonzero\":%ld,\"order\":%.3f,\"sym_hits\":%d,\"sym_checks\":%d,\"secs\":%.3f}\n",
           r->text, r->S, r->C, classify(res, maxsteps), res->steps, why[res->stop], res->period, res->onset,
           res->hdx, res->hdy, res->xmax - res->xmin + 1, res->ymax - res->ymin + 1, res->xmin, res->ymin,
           res->nonzero, res->order, res->sym_hits, res->sym_checks, res->secs);
    fflush(stdout);
}

static void dump(const char *path, const Result *res) {
    FILE *f = fopen(path, "wb");
    if (!f) { perror(path); return; }
    int32_t hdr[2] = {res->xmax - res->xmin + 1, res->ymax - res->ymin + 1};
    fwrite(hdr, sizeof hdr, 1, f);
    for (int y = res->ymin + G / 2; y <= res->ymax + G / 2; y++)
        fwrite(grid + (long)y * G + res->xmin + G / 2, 1, hdr[0], f);
    fclose(f);
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: tsim run <rule> <maxsteps> [-g G] [-d dump] [-t dumpat] | tsim batch <maxsteps> [-g G]\n"); return 2; }
    int batch = strcmp(argv[1], "batch") == 0;
    const char *rule = batch ? NULL : argv[2];
    long maxsteps = atol(argv[batch ? 2 : 3]);
    const char *dumppath = NULL; long dumpat = 0; G = 4096;
    for (int i = batch ? 3 : 4; i + 1 < argc; i += 2) {
        if (!strcmp(argv[i], "-g")) G = atoi(argv[i + 1]);
        else if (!strcmp(argv[i], "-d")) dumppath = argv[i + 1];
        else if (!strcmp(argv[i], "-t")) dumpat = atol(argv[i + 1]);
    }
    grid = calloc((size_t)G * G, 1);
    Rule r; Result res;
    if (!batch) {
        if (parse_rule(rule, &r)) { fprintf(stderr, "bad rule %s\n", rule); return 1; }
        simulate(&r, maxsteps, dumpat, &res);
        print_json(&r, &res, maxsteps);
        if (dumppath) dump(dumppath, &res);
        return 0;
    }
    char line[512];
    while (fgets(line, sizeof line, stdin)) {
        line[strcspn(line, "\r\n")] = 0;
        if (!line[0]) continue;
        if (parse_rule(line, &r)) { printf("{\"rule\":\"%s\",\"error\":\"parse\"}\n", line); continue; }
        simulate(&r, maxsteps, 0, &res);
        print_json(&r, &res, maxsteps);
        clear_bbox(&res);
    }
    return 0;
}
