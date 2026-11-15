//! Unit types and battle state.
use crate::catalog::*;

pub const N_UNITS: usize = 7; // 0 spearman, 1 archer, 2 swordsman, 3 knight, 4 catapult, 5 ram, 6 militia (conscripts, not trainable)
/// Kinds a village can train and send out: everything but the militia.
pub const NK: usize = 6;
pub const RAM: u8 = 5;
pub const MILITIA: u8 = 6;

pub struct UnitDef {
    pub name: &'static str,
    pub hp: f32,
    pub dmg: f32,
    pub range: f32,
    pub speed: f32,
    pub cd: f32,
    pub armor: f32,
    pub cost: &'static [Amount],
    pub tier: u8, // barracks tier required
    pub time: u32, // training effort
    pub desc: &'static str,
}

pub static UNITS: [UnitDef; N_UNITS] = [
    UnitDef { name: "Spearman", hp: 70.0, dmg: 10.0, range: 2.6, speed: 3.2, cd: 1.2, armor: 1.0, cost: &[(W, 4), (TL, 1)], tier: 0, time: 12, desc: "Cheap line infantry. Holds the line against knights." },
    UnitDef { name: "Archer", hp: 45.0, dmg: 8.0, range: 22.0, speed: 3.4, cd: 1.6, armor: 0.0, cost: &[(PL, 3), (W, 2)], tier: 0, time: 12, desc: "Shoots from range; fire arrows set thatched roofs alight." },
    UnitDef { name: "Swordsman", hp: 115.0, dmg: 17.0, range: 2.4, speed: 3.0, cd: 1.0, armor: 3.0, cost: &[(IR, 2), (TL, 1), (CH, 1)], tier: 1, time: 18, desc: "Mail-clad heavy infantry." },
    UnitDef { name: "Knight", hp: 170.0, dmg: 24.0, range: 2.8, speed: 7.0, cd: 1.2, armor: 4.0, cost: &[(IR, 5), (GD, 3), (GR, 12)], tier: 2, time: 30, desc: "Mounted shock cavalry. Devastating charge." },
    UnitDef { name: "Catapult", hp: 130.0, dmg: 55.0, range: 38.0, speed: 1.6, cd: 5.0, armor: 0.0, cost: &[(PL, 20), (IR, 4), (TL, 3)], tier: 3, time: 45, desc: "Siege engine. Smashes walls, digs craters and starts fires." },
    UnitDef { name: "Ram", hp: 160.0, dmg: 30.0, range: 3.0, speed: 2.4, cd: 2.5, armor: 2.0, cost: &[(W, 30), (IR, 3), (TL, 2)], tier: 2, time: 30, desc: "A roofed battering ram. Splinters gates and doors; weak against walls and useless against soldiers, so keep it guarded." },
    UnitDef { name: "Militia", hp: 40.0, dmg: 6.0, range: 2.2, speed: 3.0, cd: 1.4, armor: 0.0, cost: &[], tier: 0, time: 0, desc: "Villagers who grab pitchforks when the village is attacked." },
];

pub fn units_json() -> String {
    let items: Vec<String> = UNITS.iter().enumerate().map(|(i, u)| {
        let cost = u.cost.iter().map(|(r, n)| format!("[{},{}]", r, n)).collect::<Vec<_>>().join(",");
        format!("{{\"id\":{},\"name\":\"{}\",\"hp\":{},\"dmg\":{},\"range\":{},\"speed\":{},\"armor\":{},\"cost\":[{}],\"tier\":{},\"time\":{},\"desc\":\"{}\"}}", i, u.name, u.hp, u.dmg, u.range, u.speed, u.armor, cost, u.tier, u.time, u.desc)
    }).collect();
    format!("[{}]", items.join(","))
}

// ---------------------------------------------------------------------------------------------------------------------
// Bosses: named units with a big body, a few rules of their own and an escort. Every number lives in this table. A boss is an ordinary `Unit` (so defenders, ladders, rams, fire and
// wading all keep working) whose `boss` field is its index + 1 here; `base` is the soldier kind it moves and is drawn as.
// ---------------------------------------------------------------------------------------------------------------------
pub const N_BOSSES: usize = 2;
/// A bandit raid may be led by a boss once the village has stood `BOSS_FROM_DAYS` days with `BOSS_FROM_POP` people: one raid in `BOSS_ONE_IN`, one more often for every `BOSS_WEALTH_STEP` coin in the stores (at most `BOSS_WEALTH_MAX` times).
pub const BOSS_FROM_DAYS: u64 = 20;
pub const BOSS_FROM_POP: u32 = 25;
pub const BOSS_ONE_IN: u32 = 12;
pub const BOSS_WEALTH_STEP: u32 = 400;
pub const BOSS_WEALTH_MAX: u32 = 5;
/// The boss that leads raids, and the one that guards a lair.
pub const RAID_BOSS: u8 = 1;
pub const LAIR_BOSS: u8 = 2;
#[allow(dead_code)]   // boss numbers: named for the tests; the table is indexed by number
pub const WARLORD: u8 = 1;
#[allow(dead_code)]
pub const OGRE: u8 = 2;

pub struct BossDef {
    pub name: &'static str,
    pub names: [&'static str; 4],   // personal names: the raid picks one
    pub base: u8,                   // the soldier kind it behaves as
    pub hp: f32, pub dmg: f32, pub range: f32, pub speed: f32, pub cd: f32, pub armor: f32,
    /// Plate: a blow below `heavy` damage does only `soft` of its damage, unless it comes from a siege engine (catapult, ram). 0 = no plate.
    pub heavy: f32, pub soft: f32,
    /// War horn: every `horn_every` seconds it sounds for `horn_secs`; the escort within `horn_reach` then recover from each swing `horn_haste` faster (0 = no horn). `horn_first`: seconds to the first blast.
    pub horn_every: f32, pub horn_secs: f32, pub horn_reach: f32, pub horn_haste: f32, pub horn_first: f32,
    /// Slam: every `slam_every` seconds, when something stands within `slam_reach`, everything of the other side within it takes `slam_dmg` (half at the rim).
    pub slam_every: f32, pub slam_reach: f32, pub slam_dmg: f32,
    /// Hits against buildings (boulders for the ogre): a multiple of its blow, stone included (0 = fights like an ordinary soldier).
    pub boulder: f32,
    /// Below this share of its hit points it is enraged: blows land `rage_dmg` times harder and it moves `rage_speed` times as fast.
    pub rage_at: f32, pub rage_dmg: f32, pub rage_speed: f32,
    /// Strength: hit points scale between `scale_min` and `scale_max` of the above, for a raid boss with the village's size and age (see World::boss_scale), for a lair boss with the place's own strength.
    pub scale_min: f32, pub scale_max: f32,
    /// What it brings: escorts (spearmen, archers, swordsmen, knights) and rams at scale 1.0.
    pub escort: [u32; 4], pub rams: u32,
    /// Rewards for killing it: gold, iron, hero experience, a lift in happiness (for `mood_days`) and a captured ram.
    pub gold: i32, pub iron: i32, pub xp: u32, pub mood: i32, pub mood_days: u32, pub prize_rams: u32,
    pub desc: &'static str,
}

pub static BOSSES: [BossDef; N_BOSSES] = [
    BossDef { name: "Warlord", names: ["Garrick", "Odo the Red", "Hagen", "Brun Ironhand"], base: 3, hp: 520.0, dmg: 28.0, range: 2.9, speed: 5.2, cd: 1.3, armor: 4.0,
        heavy: 16.0, soft: 0.3, horn_every: 30.0, horn_secs: 8.0, horn_reach: 32.0, horn_haste: 0.7, horn_first: 4.0,
        slam_every: 0.0, slam_reach: 0.0, slam_dmg: 0.0, boulder: 0.0, rage_at: 0.5, rage_dmg: 1.25, rage_speed: 1.15, scale_min: 0.8, scale_max: 1.3,
        escort: [5, 3, 2, 1], rams: 1, gold: 260, iron: 40, xp: 120, mood: 8, mood_days: 10, prize_rams: 1,
        desc: "Leads a great raid in heavy plate that only siege engines and heavy blows hurt, and sounds a war horn that spurs his men on. Break the horn's rhythm and kill him." },
    BossDef { name: "Ogre of the Marches", names: ["Grum", "Thokk", "Ulg", "Mor the Wide"], base: 2, hp: 2400.0, dmg: 55.0, range: 3.2, speed: 1.9, cd: 2.0, armor: 2.0,
        heavy: 0.0, soft: 1.0, horn_every: 0.0, horn_secs: 0.0, horn_reach: 0.0, horn_haste: 0.0, horn_first: 0.0,
        slam_every: 5.0, slam_reach: 3.5, slam_dmg: 40.0, boulder: 4.0, rage_at: 0.5, rage_dmg: 1.3, rage_speed: 1.3, scale_min: 0.9, scale_max: 1.2,
        escort: [7, 4, 2, 0], rams: 0, gold: 220, iron: 30, xp: 160, mood: 6, mood_days: 8, prize_rams: 0,
        desc: "A huge brute who lairs in the hills. Slow, with a great deal of hit points, a slam that hurts everyone around him and boulders for walls. Shoot him from a distance." },
];

/// Hit points a boss starts with at strength `scale`.
pub fn boss_hp(boss: u8, scale: f32) -> f32 { BOSSES[(boss - 1) as usize].hp * scale }

pub fn bosses_json() -> String {
    let items: Vec<String> = BOSSES.iter().enumerate().map(|(i, b)| format!("{{\"id\":{},\"name\":\"{}\",\"names\":[{}],\"hp\":{},\"dmg\":{},\"speed\":{},\"armor\":{},\"hornReach\":{},\"hornSecs\":{},\"slamReach\":{},\"gold\":{},\"iron\":{},\"desc\":\"{}\"}}", i + 1, b.name, b.names.iter().map(|n| format!("\"{}\"", n)).collect::<Vec<_>>().join(","), b.hp, b.dmg, b.speed, b.armor, b.horn_reach, b.horn_secs, b.slam_reach, b.gold, b.iron, b.desc)).collect();
    format!("[{}]", items.join(","))
}

/// What a unit fights with right now (a boss has its own numbers, and rage makes it hit and move harder).
#[derive(Clone, Copy)]
pub struct Stat { pub hp: f32, pub dmg: f32, pub range: f32, pub speed: f32, pub cd: f32, pub armor: f32 }
pub fn unit_stat(u: &Unit) -> Stat {
    if u.boss == 0 { let d = &UNITS[u.kind as usize]; return Stat { hp: d.hp, dmg: d.dmg, range: d.range, speed: d.speed, cd: d.cd, armor: d.armor }; }
    let b = &BOSSES[(u.boss - 1) as usize];
    let (dm, sp) = if u.phase > 0 { (b.rage_dmg, b.rage_speed) } else { (1.0, 1.0) };
    Stat { hp: u.maxhp, dmg: b.dmg * dm, range: b.range, speed: b.speed * sp, cd: b.cd, armor: b.armor }
}

#[derive(Clone)]
pub struct Unit {
    pub side: u8, // 0 defenders, 1 attackers
    pub kind: u8,
    pub x: f32,
    pub y: f32,
    pub hx: f32, // post (defenders hold position near it)
    pub hy: f32,
    pub hp: f32,
    pub cd: f32,
    pub alive: bool,
    pub from_army: bool, // counted against the village army when it dies
    pub charge: bool,
    pub wading: bool, // an attacker in the water of a moat or river: slow, unable to fight, easy to hit
    pub anim: f32, // 0 idle/walk, >0 swinging (render hint)
    pub climb: f32, // seconds left climbing a wall or fence
    pub spot: i32,  // the ladder it is climbing, if any
    pub pelev: f32, // height of the post it was sent to (standing on a wall)
    pub elev: f32,  // height it stands at right now
    pub held: bool, // has a defensive post
    pub face: f32,
    pub det: u32,     // the field army this soldier marched in with (0 = none): its survivors go back to that army when the fight ends
    pub soak: f32,    // seconds left of being sodden after leaving the water of a moat or river: slower and weaker (see battle::SOAK_*)
    pub escaped: bool, // ran off the field alive (not killed)
    pub maxhp: f32,   // hit points it started with (a boss has more or less than its kind's)
    pub boss: u8,     // 0 an ordinary soldier, else the boss (index into BOSSES + 1)
    pub bname: u8,    // which of the boss's personal names
    pub phase: u8,    // 0 calm, 1 enraged
    pub t1: f32,      // boss clock: seconds into the horn's cycle
    pub t2: f32,      // boss clock: seconds until the slam is ready
}

impl Unit {
    /// A fresh soldier standing at (x, y), holding that spot. The caller adjusts the few fields that differ (post, charge, ...).
    pub fn new(side: u8, kind: u8, x: f32, y: f32, face: f32) -> Unit {
        Unit { side, kind, x, y, hx: x, hy: y, hp: UNITS[kind as usize].hp, cd: if kind == 4 { 6.0 } else { 0.5 }, alive: true, from_army: false, charge: kind == 3, wading: false, anim: 0.0, climb: 0.0, spot: -1, pelev: 0.0, elev: 0.0, held: false, face, det: 0, soak: 0.0, escaped: false, maxhp: UNITS[kind as usize].hp, boss: 0, bname: 0, phase: 0, t1: 0.0, t2: 0.0 }
    }
}

#[derive(Clone)]
pub struct Battle {
    pub units: Vec<Unit>,
    pub t: f32,
    pub pillage: f32,
    pub tag: i32, // 0 = bandits, otherwise id of the attacking player
    pub angle: f32, // direction (from the village centre) the attackers came from
    #[allow(dead_code)] pub atk_start: [u32; NK],
    pub atk_dead: u32,
    pub def_dead: u32,
    pub militia_dead: u32,
    pub bld_lost: u32,
    pub ladders: u32,           // ladders the attackers brought
    pub ladders_used: u32,
    pub spots: Vec<[f32; 4]>,   // ladders standing against walls: x, y, angle, busy
    pub sites: Vec<[f32; 4]>,   // moat crossings being built: x, y, angle, work done
    pub bridges: Vec<[f32; 3]>, // finished crossings: x, y, angle
    pub rout: Vec<f32>,         // per unit: seconds left running away (0 = holding)
    pub start_side: [u32; 2],   // soldiers each side began with
    pub fled: [u32; 2],         // soldiers who ran off the field alive
    pub fled_kinds: [u32; NK],   // which attackers got away
    pub fixed: Vec<[f32; 2]>,   // points along the player's own bridges: the water there can be crossed
    pub lair: i32,              // -1 an attack on the village; else the neutral place (index into terrain::neutrals) the army is fighting in
    pub lair_at: [f32; 2],      // where that place is
    pub boss: u8,               // the boss in the fight (0 none) and its name, for the report
    pub bname: u8,
}

#[derive(Clone, Copy)]
pub struct Wildfire { pub x: f32, pub y: f32, pub r: f32, pub life: f32, pub scorch: usize }
