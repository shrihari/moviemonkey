//! Live identification regression suite. Hits the real (free) APIs, so it is
//! ignored by default:
//!
//!   cargo test --test identify_live -- --ignored --nocapture
//!
//! Each case is a realistic file path and the IMDb id it must resolve to.

use futures::StreamExt;
use movie_monkey_lib::engine::matcher::identify;
use movie_monkey_lib::engine::parse::parse_path;
use movie_monkey_lib::engine::providers::Providers;
use std::path::Path;

const CASES: &[(&str, &str)] = &[
    // --- remakes & same-name titles: the year must decide
    ("/m/Dune.1984.1080p.BluRay.x264.mkv", "tt0087182"),
    ("/m/Dune.2021.2160p.WEB-DL.DDP5.1.mkv", "tt1160419"),
    ("/m/The.Lion.King.1994.1080p.BluRay.mkv", "tt0110357"),
    ("/m/The.Lion.King.2019.1080p.WEBRip.mkv", "tt6105098"),
    ("/m/Oldboy.2003.KOREAN.1080p.BluRay.mkv", "tt0364569"),
    ("/m/Oldboy.2013.1080p.BluRay.mkv", "tt1321511"),
    ("/m/The.Thing.1982.1080p.BluRay.mkv", "tt0084787"),
    // --- sequels and numbered titles
    ("/m/Toy.Story.3.2010.1080p.BluRay.mkv", "tt0435761"),
    ("/m/The.Godfather.Part.II.1974.1080p.BluRay.mkv", "tt0071562"),
    ("/m/Rocky.II.1979.720p.BluRay.mkv", "tt0079817"),
    (
        "/m/Harry.Potter.and.the.Deathly.Hallows.Part.1.2010.1080p.mkv",
        "tt0926084",
    ),
    (
        "/m/Harry.Potter.and.the.Deathly.Hallows.Part.2.2011.1080p.mkv",
        "tt1201607",
    ),
    ("/m/Kill.Bill.Vol.1.2003.1080p.BluRay.mkv", "tt0266697"),
    ("/m/Mission.Impossible.Fallout.2018.1080p.mkv", "tt4912910"),
    ("/m/21.Jump.Street.2012.1080p.BluRay.mkv", "tt1232829"),
    ("/m/300.2006.1080p.BluRay.mkv", "tt0416449"),
    ("/m/Alien.1979.Directors.Cut.1080p.BluRay.mkv", "tt0078748"),
    ("/m/Aliens.1986.Special.Edition.1080p.BluRay.mkv", "tt0090605"),
    // --- very short titles
    ("/m/It.2017.1080p.BluRay.mkv", "tt1396484"),
    ("/m/Us.2019.1080p.BluRay.mkv", "tt6857112"),
    ("/m/Up.2009.1080p.BluRay.mkv", "tt1049413"),
    // --- punctuation, accents, alternate titles
    ("/m/Se7en.1995.1080p.BluRay.mkv", "tt0114369"),
    ("/m/WALL-E.2008.1080p.BluRay.mkv", "tt0910970"),
    ("/m/Leon.The.Professional.1994.1080p.mkv", "tt0110413"),
    ("/m/Pans.Labyrinth.2006.1080p.BluRay.mkv", "tt0457430"),
    ("/m/Crouching.Tiger.Hidden.Dragon.2000.1080p.mkv", "tt0190332"),
    ("/m/Amores.Perros.2000.1080p.mkv", "tt0245712"),
    ("/m/Spider-Man.No.Way.Home.2021.1080p.WEB-DL.mkv", "tt10872600"),
    ("/m/Godzilla.Minus.One.2023.1080p.mkv", "tt23289160"),
    ("/m/Star.Wars.Episode.IV.A.New.Hope.1977.1080p.mkv", "tt0076759"),
    (
        "/m/The.Lord.of.the.Rings.The.Fellowship.of.the.Ring.2001.EXTENDED.1080p.mkv",
        "tt0120737",
    ),
    ("/m/Blade.Runner.1982.The.Final.Cut.1080p.BluRay.mkv", "tt0083658"),
    // --- library-manager naming (Radarr / Plex)
    ("/m/Amelie (2001)/Amelie (2001) - Bluray-1080p.mkv", "tt0211915"),
    ("/m/Parasite (2019)/Parasite.2019.KOREAN.1080p.mkv", "tt6751668"),
    ("/m/Heat (1995)/movie.mkv", "tt0113277"),
    // --- no year at all: popularity decides
    ("/m/Inception.mkv", "tt1375666"),
    ("/m/The.Departed.mkv", "tt0407887"),
    // --- TV: same names, countries, years
    ("/tv/The.Office.US.S02E01.720p.mkv", "tt0386676"),
    ("/tv/The.Office.UK.S01E01.mkv", "tt0290978"),
    ("/tv/Shameless.US.S01E01.720p.mkv", "tt1586680"),
    ("/tv/Doctor.Who.2005.S01E01.mkv", "tt0436992"),
    ("/tv/Battlestar.Galactica.2004.S01E01.mkv", "tt0407362"),
    ("/tv/Fargo.S01E01.1080p.mkv", "tt2802850"),
    ("/tv/Sherlock.S01E01.1080p.mkv", "tt1475582"),
    ("/tv/Dark.S01E01.GERMAN.1080p.WEB.mkv", "tt5753856"),
    ("/tv/Money.Heist.S01E01.1080p.mkv", "tt6468322"),
    ("/tv/House.of.the.Dragon.S01E01.1080p.mkv", "tt11198330"),
    ("/tv/Better Call Saul - S01E01 - Uno.mkv", "tt3032476"),
    (
        "/tv/Westworld (2016)/Season 01/Westworld (2016) - S01E01 - The Original [WEBDL-1080p].mkv",
        "tt0475784",
    ),
    ("/tv/Planet Earth II/Season 1/01 - Islands.mkv", "tt5491994"),
    ("/tv/The Expanse/S01/The.Expanse.S01E01.mkv", "tt3230854"),
    (
        "/tv/[SubsPlease] Sousou no Frieren - 05 (1080p) [ABCD1234].mkv",
        "tt22248376",
    ),
];

#[tokio::test]
#[ignore = "hits live metadata APIs"]
async fn identifies_hard_cases() {
    let providers = Providers::new();
    let results: Vec<_> = futures::stream::iter(CASES.iter())
        .map(|(path, expected)| {
            let providers = providers.clone();
            async move {
                let parsed = parse_path(Path::new(path));
                let m = identify(&providers, &parsed).await.ok().flatten();
                (*path, *expected, parsed, m)
            }
        })
        .buffer_unordered(6)
        .collect()
        .await;

    let mut failures = vec![];
    for (path, expected, parsed, m) in &results {
        let (got, ok, detail) = match m {
            Some(m) => (
                m.candidate.id.as_str(),
                m.accepted() && m.candidate.id == *expected,
                format!(
                    "{} ({:?}) score {:.2} sim {:.2}",
                    m.candidate.title, m.candidate.year, m.score, m.similarity
                ),
            ),
            None => ("-", false, "no candidates".to_string()),
        };
        let mark = if ok { "ok  " } else { "FAIL" };
        println!(
            "{mark} {path}\n     parsed {:?} {:?} -> {got} {detail}",
            parsed.title, parsed.year
        );
        if !ok {
            failures.push(*path);
        }
    }
    println!(
        "\n{} / {} identified correctly",
        CASES.len() - failures.len(),
        CASES.len()
    );
    assert!(failures.is_empty(), "failed: {failures:#?}");
}

#[tokio::test]
#[ignore = "hits live metadata APIs"]
async fn details_without_hint_use_imdb_year() {
    use movie_monkey_lib::engine::models::TitleKind;
    let p = Providers::new();
    // Cinemeta reports US release years for these; IMDb's original year must win.
    for (id, year) in [("tt1798709", 2013), ("tt0245429", 2001), ("tt0211915", 2001)] {
        let meta = p.details(id, TitleKind::Movie, None).await.unwrap();
        assert_eq!(meta.year, Some(year), "{id} {}", meta.name);
        assert!(
            meta.backdrop.is_some() && meta.overview.is_some(),
            "{id} lost rich metadata"
        );
    }
}
