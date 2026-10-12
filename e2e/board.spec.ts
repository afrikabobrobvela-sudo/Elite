import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, password: string) {
  await page.goto("/");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("En vivo", { exact: true })).toBeVisible();
}

test("Rodrigo mueve una muestra y el jefe la ve cambiar sin recargar", async ({ browser }, info) => {
  const code = `M-E2E-${info.project.name}`;
  const rodrigo = await (await browser.newContext(info.project.use)).newPage();
  const jefe = await (await browser.newContext(info.project.use)).newPage();

  await login(rodrigo, "clave-editor");
  await rodrigo.getByRole("button", { name: "Nueva muestra" }).click();
  await rodrigo.getByLabel("Muestra", { exact: true }).fill(code);
  await rodrigo.getByLabel("Recibo", { exact: true }).fill("R-1234");
  await rodrigo.getByLabel("Prueba", { exact: true }).fill("FTIR");
  await rodrigo.getByLabel("Cliente", { exact: true }).fill("Cliente de prueba");
  await rodrigo.getByLabel("Recepción de probetas (fecha y hora)", { exact: true }).fill("2026-10-05T09:30");
  await rodrigo.getByLabel("Días hábiles comprometidos", { exact: true }).fill("7");
  await rodrigo.getByLabel("Días hábiles comprometidos", { exact: true }).blur();
  await expect(rodrigo.getByLabel("Fecha compromiso", { exact: true })).toHaveValue("2026-10-14");
  await rodrigo.getByRole("button", { name: "Agregar muestra", exact: true }).click();
  await expect(rodrigo.getByRole("heading", { name: code })).toBeVisible();
  await rodrigo.getByRole("button", { name: "Cerrar" }).click();

  await login(jefe, "clave-del-jefe");
  await expect(jefe.getByRole("button", { name: "Nueva muestra" })).toBeHidden();
  // Una muestra nueva empieza en el recibo de muestra (antes del VoBo del cliente).
  await expect(jefe.getByRole("region", { name: "Recibo de muestra" }).getByText(code)).toBeVisible();
  await expect(jefe.locator("#sampleBoard .card", { hasText: code })).toContainText("Recibo R-1234");

  // Rodrigo la pasa a VoBo con una nota.
  await rodrigo.locator("#sampleBoard .card", { hasText: code }).click();
  await rodrigo.getByLabel("Nota del cambio", { exact: true }).fill("VoBo del cliente recibido");
  await rodrigo.getByRole("button", { name: "Pasar a En VoBo" }).click();
  await expect(rodrigo.getByRole("dialog").getByText("VoBo del cliente recibido")).toBeVisible();

  // El jefe lo ve en la siguiente consulta automática (cada 10 s), sin recargar.
  await expect(jefe.getByRole("region", { name: "En VoBo" }).getByText(code)).toBeVisible({ timeout: 15_000 });

  // El jefe abre el detalle: ve el historial pero no puede editar.
  await jefe.locator("#sampleBoard .card", { hasText: code }).click();
  await expect(jefe.getByRole("dialog").getByText("VoBo del cliente recibido")).toBeVisible();
  await expect(jefe.getByRole("button", { name: /Pasar a/ })).toHaveCount(0);
  await expect(jefe.getByLabel("Cliente", { exact: true })).toBeDisabled();
});

test("cotización con su muestra y tiempo registrado", async ({ page }, info) => {
  const number = `C-E2E-${info.project.name}`;
  await login(page, "clave-editor");

  // Cronómetro: inicia una actividad y la termina.
  await page.locator("#actType").selectOption("cotizacion");
  await page.getByRole("button", { name: "Iniciar" }).click();
  await expect(page.getByRole("region", { name: "Actividad en curso" }).getByText("Elaborar cotización")).toBeVisible();
  await page.getByRole("button", { name: "Terminar" }).click();
  await expect(page.getByRole("button", { name: "Iniciar" })).toBeVisible();

  // Cotización que se compra y de la que sale una muestra.
  await page.getByRole("tab", { name: "Cotizaciones" }).click();
  await page.getByRole("button", { name: "Nueva cotización" }).click();
  await page.getByLabel("Número de cotización", { exact: true }).fill(number);
  await page.getByLabel("Cliente", { exact: true }).fill("Cliente de prueba");
  // Partidas: una antes de crear la cotización y otra después; cada una con su cantidad.
  await page.getByLabel("Prueba de la partida").fill("Flamabilidad Horizontal");
  await page.getByLabel("Cantidad", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Agregar partida" }).click();
  await expect(page.getByText("1 partida · 5 pruebas en total")).toBeVisible();
  await page.getByRole("button", { name: "Agregar cotización" }).click();
  await expect(page.getByRole("heading", { name: number })).toBeVisible();
  await expect(page.getByText("1 partida · 5 pruebas en total")).toBeVisible();
  await page.getByLabel("Prueba de la partida").fill("FTIR");
  await page.getByLabel("Prueba de la partida").press("Enter");
  await expect(page.getByText("2 partidas · 6 pruebas en total")).toBeVisible();
  await page.getByLabel("Cantidad de la partida 2").fill("2");
  await page.getByLabel("Cantidad de la partida 2").blur();
  await expect(page.getByText("2 partidas · 7 pruebas en total")).toBeVisible();
  await page.getByLabel("Elegir estado", { exact: true }).selectOption("comprada");
  await page.getByRole("button", { name: "Mover" }).click();
  await expect(page.getByRole("dialog").getByText("Estado: Comprada")).toBeVisible();

  // Una prueba que va para otro consultor, escrita a mano (no está en la lista).
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Prueba", { exact: true }).fill("Resistencia a sustancias químicas");
  await dialog.getByLabel("Consultor", { exact: true }).fill("Consultor B");
  await dialog.getByRole("button", { name: "Agregar prueba" }).click();
  await expect(dialog.getByRole("button", { name: "Resistencia a sustancias químicas" })).toBeVisible();
  await dialog.getByRole("button", { name: "Resistencia a sustancias químicas" }).click();
  await expect(page.getByLabel("Reporte prometido para", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();

  // Y una propia con todos los datos. La tarjeta muestra las partidas.
  await expect(page.locator("#quoteBoard .card", { hasText: number })).toContainText("Flamabilidad Horizontal ×5, FTIR ×2");
  await page.locator("#quoteBoard .card", { hasText: number }).click();
  await page.getByRole("button", { name: "Agregar con todos los datos" }).click();
  await page.getByLabel("Muestra", { exact: true }).fill(`M-${number}`);
  await page.getByLabel("Prueba", { exact: true }).fill("Flamabilidad Horizontal");
  await page.getByRole("button", { name: "Agregar muestra", exact: true }).click();
  await expect(page.getByRole("heading", { name: `M-${number}` })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();

  // La línea del tiempo junta las dos cosas.
  await page.getByRole("tab", { name: "Mi productividad" }).click();
  await expect(page.locator("#timeline").getByText(number).first()).toBeVisible();
  await expect(page.locator("#chartTypes").getByText("Elaborar cotización")).toBeVisible();
});

test("cotización con fechas pasadas pide seguimiento a los 15 días", async ({ page }, info) => {
  const number = `C-OLD-${info.project.name}`;
  const local = (daysAgo: number) => {
    const d = new Date(Date.now() - daysAgo * 864e5);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
  };
  await login(page, "clave-editor");
  await page.getByRole("tab", { name: "Cotizaciones" }).click();
  await page.getByRole("button", { name: "Nueva cotización" }).click();
  await page.getByLabel("Número de cotización", { exact: true }).fill(number);
  await page.getByLabel("Emisión", { exact: true }).fill(local(30));
  await page.getByLabel("Envío al cliente", { exact: true }).fill(local(20));
  await page.getByRole("button", { name: "Agregar cotización" }).click();
  await expect(page.getByRole("heading", { name: number })).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Estado: Enviada al cliente")).toBeVisible();
  await expect(dialog.getByText(/sin seguimiento/)).toBeVisible();
  await expect(page.locator("#remind")).toContainText(number);

  // Registrar el seguimiento quita el recordatorio.
  await page.getByRole("button", { name: "Registrar seguimiento" }).click();
  await expect(dialog.getByText("Estado: En seguimiento")).toBeVisible();
  await expect(page.locator("#remind")).not.toContainText(number);

  // Corregir la fecha del envío desde el historial.
  await dialog.getByRole("button", { name: "Corregir fecha de Enviada al cliente" }).click();
  await page.locator("#ev_at").fill(local(19));
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator("#ev_at")).toHaveCount(0);
});

test("modo demo: datos ficticios sin tocar la base real", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await page.getByRole("button", { name: "Ver demo con datos ficticios" }).click();
  await expect(page.getByRole("region", { name: "Modo demo" })).toBeVisible();
  await expect(page.locator("#sampleBoard .card").first()).toBeVisible();
  await expect(page).toHaveURL(/\?demo/);

  // Un cambio en el demo se ve en pantalla...
  await page.getByRole("button", { name: "Nueva muestra" }).click();
  await page.getByLabel("Muestra", { exact: true }).fill("DEMO-NUEVA");
  await page.getByRole("button", { name: "Agregar muestra", exact: true }).click();
  await expect(page.getByRole("heading", { name: "DEMO-NUEVA" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();

  // ...y la vista del jefe es de solo lectura.
  await page.getByRole("button", { name: "Ver como jefe" }).click();
  await expect(page.getByRole("button", { name: "Nueva muestra" })).toBeHidden();
  await page.getByRole("tab", { name: "Mi productividad" }).click();
  await expect(page.locator("#chartHours .bar").first()).toBeVisible();
  await expect(page.locator("#timeline .ti").first()).toBeVisible();

  // Al salir, la página pide contraseña y la base real no tiene esa muestra.
  await page.getByRole("button", { name: "Salir" }).click();
  await login(page, "clave-editor");
  await expect(page.locator("#sampleBoard").getByText("DEMO-NUEVA")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("contraseña incorrecta", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Contraseña", { exact: true }).fill("no-es");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Contraseña incorrecta.");
});

test("tiempo pasado en una muestra, corrección y guardado automático", async ({ page }, info) => {
  const code = `M-AUTO-${info.project.name}`;
  await login(page, "clave-editor");
  await page.getByRole("button", { name: "Nueva muestra" }).click();
  await page.getByLabel("Muestra", { exact: true }).fill(code);
  // Cerrar sin guardar conserva lo capturado como borrador.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Nueva muestra" }).click();
  await expect(page.getByLabel("Muestra", { exact: true })).toHaveValue(code);
  await expect(page.getByText("Recuperé lo que habías capturado")).toBeVisible();
  await page.getByRole("button", { name: "Agregar muestra", exact: true }).click();
  await expect(page.getByRole("heading", { name: code })).toBeVisible();

  // Un dato editado se guarda solo, aunque se cierre el panel sin pulsar nada.
  await page.getByLabel("Cliente", { exact: true }).fill("Cliente guardado solo");
  await page.keyboard.press("Escape");
  await page.locator("#sampleBoard .card", { hasText: code }).click();
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue("Cliente guardado solo");

  // Tiempo que se olvidó iniciar: se registra con inicio y fin, y luego se corrige.
  await page.getByRole("button", { name: "Registrar tiempo pasado" }).last().click();
  await page.getByLabel("Inicio", { exact: true }).fill("2026-10-05T09:00");
  await page.getByLabel("Fin", { exact: true }).fill("2026-10-05T11:00");
  await page.getByRole("button", { name: "Guardar registro" }).click();
  await expect(page.getByRole("heading", { name: code })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("2 h", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Corregir inicio y fin/ }).click();
  await page.getByLabel("Fin", { exact: true }).fill("2026-10-05T12:00");
  await page.getByLabel("Fin", { exact: true }).blur();
  await expect(page.getByText("Guardado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Volver a ${code}` }).click();
  await expect(page.getByRole("dialog").getByText("3 h", { exact: false }).first()).toBeVisible();
});

test("una muestra que no es de tu cliente no pasa por VoBo", async ({ page }, info) => {
  const code = `M-SINVOBO-${info.project.name}`;
  await login(page, "clave-editor");
  await page.getByRole("button", { name: "Nueva muestra" }).click();
  await page.getByLabel("Muestra", { exact: true }).fill(code);
  await page.getByLabel(/La parte administrativa/).uncheck();
  const initial = page.getByLabel("Etapa inicial");
  await expect(initial).toHaveValue("recibido");
  await expect(initial.locator("option", { hasText: "En VoBo" })).toHaveCount(0);
  await page.getByRole("button", { name: "Agregar muestra", exact: true }).click();
  await expect(page.getByRole("heading", { name: code })).toBeVisible();
  await expect(page.getByLabel("Elegir etapa").locator("option", { hasText: "En VoBo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pasar a Acondicionando" })).toBeVisible();
});

/** Cotización ficticia en PDF con el formato del laboratorio (posiciones en puntos, como la original). */
async function fakeQuotePdf(browser: import("@playwright/test").Browser) {
  const span = (x: number, top: number, s: string) => `<span style="position:absolute;left:${x}pt;top:${top}pt">${s}</span>`;
  const html = `<html><body style="margin:0;font:9pt sans-serif">
    ${span(444, 14, "Referencia:")}${span(525, 14, "C26 777")}
    ${span(462, 28, "Fecha :")}${span(536, 28, "2026/9/3")}
    ${span(53, 62, "Elabora:")}${span(90, 62, "Persona Que Cotiza")}
    ${span(49, 98, "Empresa:")}${span(93, 98, "Empresa Ficticia")}
    ${span(30, 166, "Partida")}${span(87, 166, "Cantidad")}${span(143, 166, "Descripción")}${span(419, 166, "P.Unitario")}
    ${span(58, 196, "1")}${span(87, 196, "3.00")}${span(144, 196, "Flamabilidad horizontal (*) según")}${span(439, 196, "1,000.00")}
    ${span(144, 208, "ISO 3795")}
    ${span(58, 260, "2")}${span(87, 260, "2.00")}${span(144, 260, "Índice de fluidez")}${span(439, 260, "900.00")}
    ${span(27, 640, "Observaciones :")}
  </body></html>`;
  const page = await browser.newPage();
  await page.setContent(html);
  const pdf = await page.pdf({ width: "8.5in", height: "11in" });
  await page.close();
  return pdf;
}

test("importar partidas desde una cotización en PDF", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "escritorio", "basta con un navegador");
  const pdf = await fakeQuotePdf(browser);
  await login(page, "clave-editor");
  await page.getByRole("tab", { name: "Cotizaciones" }).click();
  await page.getByRole("button", { name: "Nueva cotización" }).click();
  await page.locator("[data-quote-pdf]").setInputFiles({ name: "C26.777.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/Leí 2 partidas \(5 pruebas\) de C26\.777/)).toBeVisible();
  await expect(page.getByLabel("Número de cotización", { exact: true })).toHaveValue("C26.777");
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue("Empresa Ficticia");
  await expect(page.getByLabel("Vendedor", { exact: true })).toHaveValue("Persona Que Cotiza");
  await expect(page.getByLabel("Emisión")).toHaveValue("2026-09-03T09:00");
  await expect(page.getByText("Flamabilidad horizontal según ISO 3795")).toBeVisible();
  await page.getByRole("button", { name: "Agregar cotización" }).click();
  await expect(page.getByRole("heading", { name: "C26.777" })).toBeVisible();
  await expect(page.getByText("2 partidas · 5 pruebas en total")).toBeVisible();
});
