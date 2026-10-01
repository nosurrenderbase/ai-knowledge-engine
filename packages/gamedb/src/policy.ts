/**
 * What of the game database may be read, and what never leaves it.
 *
 * Only the collections listed here are visible. Personal and payment data
 * stays out three ways: whole collections are absent (receipts, push and chat
 * tokens, deleted accounts, the KYC database is never connected), `users` is
 * read through a field allowlist, and field names that look personal are
 * refused in queries and dropped from results at any depth (see guard.ts).
 */

export interface CollectionPolicy {
  /** What it holds, for the model. */
  about: string;
  /** Knowledge base document that explains it (area-prefixed). */
  doc?: string;
  /** Top-level fields that may be returned; absent = all fields minus the denied names. */
  fields?: string[];
  /** May other collections join into it ($lookup, $graphLookup, $unionWith)? */
  joinable?: boolean;
}

const B = 'backend/';

export const COLLECTIONS: Record<string, CollectionPolicy> = {
  // Hesap (alan izin listesiyle; e-posta, telefon, giriş sağlayıcıları, cihaz token'ları yok)
  users: {
    about: 'Oyuncu hesabı: başkan adı ve avatarı (boss), varsayılan takım, tutorial durumu, hesap kilidi (block), rol, davet kodu, Pro/KYC sonuç tarihleri, eski sezon özeti',
    doc: `${B}modules/user.md`,
    fields: ['_id', 'userId', 'boss', 'defaultTeamId', 'tutorialState', 'timezone', 'tags', 'block', 'role', 'referralCode', 'isPro', 'kycApprovedAt', 'proPackageGrantedAt', 'kycFailureAt', 'kycReviewStatusAt', 'legacyKycVerifiedAt', 'networkPointForRef', 'legacySeasons', 'createdAt', 'updatedAt'],
    joinable: false,
  },
  user_activities: {about: 'Oyuncunun son görülme zamanı', doc: `${B}flows/aktiflik/son-gorulme.md`},
  feature_flags: {about: 'Özellik bayrakları', doc: `${B}flows/feature-flag/ozellik-bayraklari.md`},

  // Takım, oyuncu
  teams: {about: 'Takım: ad, diziliş, taktikler (matchTactics), renkler, arma, sahibi (ownerId), bot mu', doc: `${B}flows/takim/takim-ayarlari.md`, joinable: true},
  teamPlayers: {about: 'Takımın oyuncuları: kadro yeri (squadSlot 1-18), detaylı statlar, pozisyonel overall, kondisyon, moral, stamina, sakatlık, ceza, tesis görevi, oyun stilleri', doc: `${B}flows/team-player/kadro-ve-dizilis.md`, joinable: true},
  team_player_transactions: {about: 'Moral değişiklikleri defteri (önce/sonra/fark, sebep)', doc: `${B}flows/team-player/ozel-roller-ve-moral.md`, joinable: true},
  players: {about: 'Futbolcu kartı kataloğu', doc: `${B}modules/player.md`, joinable: true},
  buildings: {about: 'Takım başına binalar: seviye, yükseltme, stadyum koltukları', doc: `${B}flows/building/insaat-ve-yukseltme.md`, joinable: true},

  // Lig ve maç
  leagues: {about: 'Ligler: kademe (leagueDefinitionId), takımlar, Pro mu, ilk/son maç zamanı, tamamlandı mı, motorun yazdığı puan tablosu', doc: `${B}flows/lig/kademeler-ve-yukselme.md`, joinable: true},
  league_fixtures: {about: 'Lig maçları: ev/deplasman takımı, maç saati (matchDate), durum (scheduled/processing/simulated/uploading/completed/failed/dead), skor, kazanan, istatistik (stats), hata, deneme sayısı, ödül işlendi damgası (processedAt)', doc: `${B}flows/lig/fikstur-ve-mac-saatleri.md`, joinable: true},
  match_input_snapshots: {about: 'Maç motorunun her maç için yazdığı girdi fotoğrafı: iki takımın kadrosu, taktikleri, motor sürümü, tohum', doc: 'mac-motoru/flows/cikti/mac-anlik-goruntusu.md', joinable: true},
  team_leagues: {about: 'Takım başına lig satırı: kademe, şu anki lig, ömür boyu sayaçlar (galibiyet/beraberlik/mağlubiyet), son lig sonucu, küme düşme durumu', doc: `${B}flows/mac-sonucu/istatistik-sayaclari.md`, joinable: true},
  team_league_histories: {about: 'Biten her lig için takım başına geçmiş satırı (sıra, puan, ödül)', doc: `${B}flows/lig/lig-sonu-kapanisi.md`, joinable: true},
  matchmaking_history: {about: 'Her eşleştirme çalışmasının özeti', doc: `${B}flows/lig/haftalik-lig-kurulumu.md`, joinable: true},
  pvp_matches: {about: 'PvP maçları: durum, taraflar (challengerUserId/opponentUserId), kaynak, skor, sonuç, zaman damgaları', doc: `${B}flows/pvp/meydan-okuma.md`, joinable: true},

  // Ekonomi
  user_resources: {about: 'Oyuncu cüzdanı: LD bakiyesi, Fan Love, reklam atlama bileti, saatlik gelir', doc: `${B}flows/resource/bakiye-ve-islem-defteri.md`, joinable: true},
  transactions: {about: 'Kaynak hareketleri defteri: miktar, yön, sonraki bakiye, sebep (alt tür)', doc: `${B}flows/resource/bakiye-ve-islem-defteri.md`, joinable: true},
  club_economy_states: {about: 'Jeneratör hatları, kasa, 2× hızlandırıcı', doc: `${B}flows/club-economy/kasa-ve-pasif-gelir.md`, joinable: true},
  president_states: {about: 'Başkan puanı (LP), zirve LP', doc: `${B}flows/president/lp-kaynaklari.md`, joinable: true},
  president_lp_transactions: {about: 'LP defteri', doc: `${B}flows/president/baskan-seviyesi.md`, joinable: true},
  media_states: {about: 'Medya binası: PR kampanyaları, sponsor teklifleri', doc: `${B}flows/media/pr-kampanyasi.md`, joinable: true},
  sponsor_states: {about: 'Haftalık sponsor sözleşmeleri', doc: `${B}flows/sponsorship/sponsor-sozlesmeleri.md`, joinable: true},
  store_strategy_states: {about: 'Mağaza rafları ve flaş indirim durumu', doc: `${B}flows/magaza/urun-dizilimi-ve-stok.md`, joinable: true},
  inbox: {about: 'Gelen kutusu mesajları ve bekleyen ödüller', doc: `${B}flows/inbox/mesaj-kaynaklari.md`, joinable: true},

  // Paket, scout, moral
  pack_definitions: {about: 'Paket tanımları', doc: `${B}flows/inventory/paket-acma.md`, joinable: true},
  training_card_definitions: {about: 'Antrenman kartı tanımları', doc: `${B}flows/inventory/paket-verme-ve-envanter.md`, joinable: true},
  user_packs: {about: 'Oyuncu + paket başına kapalı paket adedi', doc: `${B}flows/inventory/paket-verme-ve-envanter.md`, joinable: true},
  user_training_cards: {about: 'Oyuncu + kart başına adet', doc: `${B}flows/team-player/kocluk-antrenman-karti.md`, joinable: true},
  training_pack_slots: {about: 'Gün başına kazanılan antrenman paketi sırası', doc: `${B}flows/antrenman-paketi/antrenman-paketi-takvimi.md`, joinable: true},
  scout_market_states: {about: 'Scout hakları, raporlar, pity sayaçları', doc: `${B}flows/scout/rapor-ve-nadirlik.md`, joinable: true},
  player_decision_states: {about: 'O gün kullanılan oyuncu kararları', doc: `${B}flows/moral/oyuncu-kararlari.md`, joinable: true},
  morale_boost_states: {about: 'Günlük takım moral boost durumu', doc: `${B}flows/moral/takim-moral-boost.md`, joinable: true},

  // Görev, günlük ödül, reklam, mini oyun
  mission_schedules: {about: 'Günlük görev ızgaraları', doc: `${B}flows/gorev/gunluk-gorev-takvimi.md`, joinable: true},
  user_daily_missions: {about: 'Oyuncunun o günkü görevleri', doc: `${B}flows/gorev/gunluk-gorev-odulu.md`, joinable: true},
  user_seasonal_missions_v2: {about: 'Sezonluk ve ömür boyu görevler', doc: `${B}flows/gorev/sezonluk-gorevler.md`, joinable: true},
  user_mission_counters_v2: {about: 'Görev sayaçları', doc: `${B}flows/gorev/gorev-ilerlemesi.md`, joinable: true},
  user_missions: {about: 'Tutorial görevleri ve bölüm durumu', doc: `${B}flows/baslangic-gorevleri/baslangic-gorevleri.md`, joinable: true},
  daily_checkins: {about: 'Günlük giriş serisi', doc: `${B}flows/gunluk-giris/gunluk-giris-odulu.md`, joinable: true},
  adwatch_limits: {about: 'Reklam türü başına günlük/saatlik sayaç', doc: `${B}flows/reklam/reklam-izleme-kapisi.md`, joinable: true},
  adwatch_events: {about: 'Reklam/bilet kullanım geçmişi', doc: `${B}flows/reklam/reklam-izleme-kapisi.md`, joinable: true},
  mini_game_claim_states: {about: 'Mini oyun günlük hakları', doc: `${B}flows/mini-game/gunluk-hak.md`, joinable: true},
  mini_game_events: {about: 'Mini oyun koşuları, skor ve ödül', doc: `${B}flows/mini-game/odul-hesabi.md`, joinable: true},

  // Sosyal ve Pro
  friend_lists: {about: 'Arkadaş listeleri', doc: `${B}flows/arkadas/arkadas-listesi.md`, joinable: true},
  friend_requests: {about: 'Bekleyen arkadaşlık istekleri', doc: `${B}flows/arkadas/arkadaslik-istegi.md`, joinable: true},
  referrals: {about: 'Davetler: davet eden, davetli, ödül, durum', doc: `${B}flows/referans/kod-uygulama.md`, joinable: true},
  user_cosmetics: {about: 'Pro kozmetikleri', doc: `${B}flows/pro-kayit/pro-paketi.md`, joinable: true},
  perk_definitions: {about: 'Avantaj tanımları', doc: `${B}modules/perk.md`, joinable: true},
  user_perks: {about: 'Oyuncunun aktif avantajları', doc: `${B}modules/perk.md`, joinable: true},

  // Eski oyun
  user_season_archives: {about: 'Eski oyunun sezon özetleri', doc: `${B}modules/season-archive.md`, joinable: true},
  userachievements: {about: 'Eski başarımlar', doc: `${B}modules/user-achievement.md`, joinable: true},
};

/**
 * Field names that are never read or returned, at any depth: contact data,
 * login and device identifiers, credentials, payment and identity data, and
 * storage addresses. Matched against every path segment, case-insensitively.
 */
export const DENIED_FIELD = new RegExp(
  [
    'email',
    'phone',
    'password',
    'secret',
    'iban',
    'signature',
    'receipt',
    '^tc(kn|no)?$',
    'identity(number|no)',
    'nationalid',
    '^(first|last|full)name$',
    '^ip$',
    'ipaddress',
    'deviceid',
    '^(idfa|gaid|adid)$',
    'tokens?$',
    '^sumsub',
    'applicantid',
    'connectedproviders',
    'providerid',
    'tickdataurl',
  ].join('|'),
  'i',
);

/** Query operators and stages that could run code, write, or reach outside the allowed collections. */
export const FORBIDDEN_OPERATORS = new Set([
  '$where',
  '$function',
  '$accumulator',
  '$out',
  '$merge',
  '$currentOp',
  '$listSessions',
  '$listLocalSessions',
  '$planCacheStats',
  '$changeStream',
  '$documents',
]);

export const LIMITS = {
  /** Documents a find returns at most. */
  maxFind: 100,
  defaultFind: 20,
  /** Documents an aggregation returns at most (a final $limit is always added). */
  maxAggregate: 200,
  /** Server-side time limit per query. */
  maxTimeMS: 10_000,
  /** Arrays longer than this are cut in results. */
  maxArray: 60,
  /** Characters of serialized output per tool call. */
  maxChars: 60_000,
};
