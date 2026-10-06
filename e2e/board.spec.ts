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
  await page.getByRole("button", { name: "Agregar cotización" }).click();
  await expect(page.getByRole("heading", { name: number })).toBeVisible();
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

  // Y una propia con todos los datos.
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
