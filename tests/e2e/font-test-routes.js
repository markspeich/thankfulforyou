export const SEEDED_FONT_RECORDS = [
  {
    id: "candlepin",
    display_name: "Candlepin Laser",
    family_name: "CandlepinLaser",
    public_url: "public/fonts/Candlepin-Laser.otf",
    file_format: "otf",
    version: 1,
  },
  {
    id: "skywalk",
    display_name: "Skywalk Laser",
    family_name: "SkywalkLaser",
    public_url: "public/fonts/SkywalkLaserRegular.otf",
    file_format: "otf",
    version: 1,
  },
  {
    id: "somekind",
    display_name: "Somekind",
    family_name: "Somekind",
    public_url: "public/fonts/Somekind.ttf",
    file_format: "ttf",
    version: 1,
  },
];

export async function installSeededFontRoute(page) {
  await page.route("**/api/fonts**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ fonts: SEEDED_FONT_RECORDS }),
    });
  });
}
