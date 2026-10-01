import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {manualPart} from '../src/cards.ts';
import {parseDoc} from '../src/docs.ts';
import {generateEngineDocs} from '../src/engine-cards.ts';
import {buildEngineModel, factorAt, goConstants, inPool, usersOf} from '../src/engine-model.ts';
import {initRepo, read, tmpDir, write} from './helpers.ts';

const ENGINE: Record<string, string> = {
  'internal/ai/attr.go': `package ai

type Attr struct {
	SprintSpeed float64 // movement.sprintSpeed -> top speed
	Tackle      float64
	ShortPassing float64
	Kicking     float64
	Height      int // cm
	Styles      map[string]bool
}

const attrAvg = 70.0

const (
	completionGain = 0.12 // pass completion
)

func (a *Attr) engineStats() []*float64 {
	return []*float64{&a.SprintSpeed, &a.Tackle, &a.ShortPassing, &a.Kicking, &a.Height}
}

func attrFactor(stat float64, gain float64) float64 {
	return 1 + gain*(stat-attrAvg)/30.0
}

// SpeedFactor scales top speed.
func (a Attr) SpeedFactor() float64 {
	return attrFactor(a.SprintSpeed, 0.12) * a.styleMul(HookSpeed)
}

func (a Attr) CompletionFactor() float64 { return attrFactor(a.ShortPassing, completionGain) }

func (a Attr) styleMul(h StyleHook) float64 { return 1 }
`,
  'internal/ai/styles.go': `package ai

type StyleHook int

const (
	// Yetenek
	HookSpeed StyleHook = iota // sprint üst hızı
	// Eğilim
	HookTendPress // pres angajmanı

	hookCount
)

const (
	styleExec     = 1.05
	styleExecPlus = 1.08
	styleTend     = 1.20
	styleTendPlus = 1.35
)

var styleRegistry = map[string][]styleEffect{
	"rapid":      {{hook: HookSpeed}},
	"jockey":     {{hook: HookTendPress, tend: true, inv: true}}, // faz-2
	// Hava
	"block":      {{hook: HookSpeed}},
}
`,
  'internal/ai/player_brain.go': `package ai

type PlayerBrain struct{ attr Attr }

func (pb *PlayerBrain) SetAttr(a Attr) {
	pb.speed *= pb.attr.SpeedFactor()
}
`,
  'internal/match/match.go': `package match

func (mt *Match) checkFoul() {
	raw := mt.attrOf(def).Tackle - 3
	p := carrier.CompletionFactor()
}
`,
  'internal/lineup/attr_bridge.go': `package lineup

func AttrFromPlayer(p models.TeamPlayer) ai.Attr {
	d := p.DetailedStats
	pace := boost("pace") + boost("speed")
	pas, def := boost("passing"), boost("defending")
	a := ai.Attr{
		SprintSpeed:  eff(d.Movement.SprintSpeed, 0.55, pace),
		Tackle:       eff(d.Defending.StandingTackle, 0.30, def),
		ShortPassing: eff(d.Attacking.ShortPassing, 0.35, pas),
		Kicking:      eff(d.Goalkeeping.Kicking, 1, boost("kicking")),
		Height: p.Height,
	}
	if p.IsGoalkeeper() && a.Kicking > 0 {
		a.ShortPassing = a.Kicking
	}
	return a
}
`,
  'internal/models/player.go': `package models

type DetailedAttackingStats struct {
	Crossing     int \`bson:"crossing" json:"crossing"\`
	ShortPassing int \`bson:"shortPassing" json:"shortPassing"\`
}

type DetailedMovementStats struct {
	SprintSpeed int \`bson:"sprintSpeed" json:"sprintSpeed"\`
}

type DetailedDefendingStats struct {
	StandingTackle int \`bson:"standingTackle" json:"standingTackle"\`
}

type DetailedGoalkeepingStats struct {
	Kicking int \`bson:"kicking" json:"kicking"\`
}

type DetailedStats struct {
	Attacking   DetailedAttackingStats   \`bson:"attacking" json:"attacking"\`
	Movement    DetailedMovementStats    \`bson:"movement" json:"movement"\`
	Defending   DetailedDefendingStats   \`bson:"defending" json:"defending"\`
	Goalkeeping DetailedGoalkeepingStats \`bson:"goalkeeping" json:"goalkeeping"\`
}
`,
};

describe('goConstants and factorAt', () => {
  it('reads numeric constants from const blocks and single lines', () => {
    const c = goConstants('const a = 1.5\nconst (\n\tb = 0.30 // x\n\tc float64 = 2\n)\nfunc f() { d = 3 }\n');
    assert.deepEqual([...c.entries()], [['a', 1.5], ['b', 0.3], ['c', 2]]);
  });

  it('is 1 at the neutral value and clamped to 1 ± gain', () => {
    assert.equal(factorAt(0.3, 70), 1);
    assert.equal(factorAt(0.3, 99), 1.29);
    assert.equal(factorAt(0.3, 0), 0.7);
  });
});

describe('match engine model and documents', () => {
  let root: string;
  let src: string;
  let area: string;

  before(() => {
    root = tmpDir();
    src = path.join(root, 'engine');
    area = path.join(root, 'kb/mac-motoru');
    initRepo(src, ENGINE);
  });
  after(() => fs.rmSync(root, {recursive: true, force: true}));

  it('follows a stat from the database to the functions that use it', () => {
    const m = buildEngineModel(src);
    assert.deepEqual(m.fields.map(f => f.name), ['SprintSpeed', 'Tackle', 'ShortPassing', 'Kicking', 'Height', 'Styles']);
    assert.deepEqual(
      m.dbStats.map(s => [s.path, s.field, s.face, s.share]),
      [
        ['attacking.crossing', null, null, null],
        ['attacking.shortPassing', 'ShortPassing', 'passing', 0.35],
        ['movement.sprintSpeed', 'SprintSpeed', 'pace + speed', 0.55],
        ['defending.standingTackle', 'Tackle', 'defending', 0.3],
        ['goalkeeping.kicking', 'Kicking', 'kicking', 1],
      ],
    );
    const speed = m.funcs.find(f => f.name === 'Attr.SpeedFactor')!;
    assert.deepEqual(speed.gains.map(g => [g.expr, g.value]), [['0.12', 0.12]]);
    assert.deepEqual(speed.hooks, ['HookSpeed']);
    assert.deepEqual(m.funcs.find(f => f.name === 'Attr.CompletionFactor')!.gains.map(g => [g.expr, g.value]), [['completionGain', 0.12]]);
    assert.deepEqual(m.callSites.get('SpeedFactor')?.map(s => s.func), ['PlayerBrain.SetAttr']);
    assert.deepEqual(usersOf(m, 'Tackle').map(u => u.func.name), ['Match.checkFoul'], 'attrOf(x).Tackle doğrudan okuma sayılır');
    assert.deepEqual(usersOf(m, 'ShortPassing').map(u => [u.func.name, u.via]), [['Attr.CompletionFactor', []], ['Match.checkFoul', ['CompletionFactor']]]);
    assert.ok(inPool(m, 'Tackle'), 'engineStats listesi kullanıcı değil, havuz sayılır');
    assert.deepEqual(m.aliases.get('Kicking'), {targets: ['ShortPassing'], when: 'p.IsGoalkeeper()'});
    assert.deepEqual(m.styles.map(s => [s.name, s.effects, s.note]), [
      ['rapid', [{hook: 'HookSpeed', tend: false, inv: false}], ''],
      ['jockey', [{hook: 'HookTendPress', tend: true, inv: true}], 'faz-2'],
      ['block', [{hook: 'HookSpeed', tend: false, inv: false}], ''],
    ]);
    assert.deepEqual(m.hooks.map(h => [h.name, h.kind]), [['HookSpeed', 'exec'], ['HookTendPress', 'tend']]);
  });

  it('writes metric cards, the metric map and the play-style table', () => {
    const res = generateEngineDocs({areaDir: area, sourceDir: src});
    assert.equal(res.metrics, 7, '5 detailed stat + height + playStyles');

    const speed = read(area, 'metrikler/sprint-speed.md');
    assert.equal(parseDoc(speed).meta.usage, 'kullanılıyor');
    assert.match(manualPart(speed), /_TODO:/);
    assert.match(speed, /\| `Attr.SpeedFactor` \| `internal\/ai\/attr.go:\d+` \| doğrudan okur \| `attrFactor\(a.SprintSpeed, 0.12\)` \| ×0.92 … ×1.08 \| `HookSpeed` \|/);
    assert.match(speed, /`pace \+ speed` kart yüzünün takviyesinin 0.55 katı/);
    assert.match(speed, /- `Attr.SpeedFactor`: `PlayerBrain.SetAttr`/);

    assert.equal(parseDoc(read(area, 'metrikler/crossing.md')).meta.usage, 'kullanılmıyor');
    assert.match(read(area, 'metrikler/crossing.md'), /Motor bu statı okumuyor/);
    const kicking = read(area, 'metrikler/kicking.md');
    assert.equal(parseDoc(kicking).meta.usage, 'kullanılıyor', 'kalecide pas statının yerine geçer');
    assert.match(kicking, /`p.IsGoalkeeper\(\)` olduğunda bu değeri `ShortPassing` alanlarına kopyalar/);

    const map = read(area, 'genel/metrik-haritasi.md');
    assert.match(map, /## Motorun okumadığı statlar\n\n- \[`detailedStats.attacking.crossing`\]\(\.\.\/metrikler\/crossing\.md\)/);
    assert.match(map, /\| \[`detailedStats.defending.standingTackle`\]\(\.\.\/metrikler\/standing-tackle\.md\) \| `Tackle` \| `Match.checkFoul` \| defending × 0.3 \|/);
    const styles = read(area, 'genel/oyun-stilleri.md');
    assert.match(styles, /\| `jockey` \| `HookTendPress` ×0.83 \(ters\) \| faz-2 \|/);
  });

  it('keeps the written paragraph and reports cards of stats that went away', () => {
    const file = path.join(area, 'metrikler/sprint-speed.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/_TODO:[^\n]*/, 'Koşu hızını belirler.'));
    write(area, 'metrikler/eski-stat.md', '---\ntype: metric\n---\n\nx\n');
    const res = generateEngineDocs({areaDir: area, sourceDir: src});
    assert.match(read(area, 'metrikler/sprint-speed.md'), /Koşu hızını belirler\./);
    assert.deepEqual(res.orphanCards, ['metrikler/eski-stat.md']);
  });
});
