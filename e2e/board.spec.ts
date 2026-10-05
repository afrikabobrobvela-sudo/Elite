import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, password: string) {
  await page.goto("/");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("En vivo")).toBeVisible();
}

test("Rodrigo mueve una muestra y el jefe la ve cambiar sin recargar", async ({ browser }, info) => {
  const code = `M-E2E-${info.project.name}`;
  const rodrigo = await (await browser.newContext(info.project.use)).newPage();
  const jefe = await (await browser.newContext(info.project.use)).newPage();

  await login(rodrigo, "clave-editor");
  await rodrigo.getByRole("button", { name: "Nueva muestra" }).click();
  await rodrigo.getByLabel("Muestra", { exact: true }).fill(code);
  await rodrigo.getByLabel("Prueba", { exact: true }).selectOption("FTIR");
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
  // Una muestra nueva empieza en VoBo (antes de que lleguen las probetas).
  await expect(jefe.getByRole("region", { name: "En VoBo" }).getByText(code)).toBeVisible();

  // Rodrigo la pasa a maquinado con una nota.
  await rodrigo.locator("#sampleBoard .card", { hasText: code }).click();
  await rodrigo.getByLabel("Nota del cambio", { exact: true }).fill("VoBo del cliente recibido");
  await rodrigo.getByRole("button", { name: "Pasar a En maquinado" }).click();
  await expect(rodrigo.getByRole("dialog").getByText("VoBo del cliente recibido")).toBeVisible();

  // El jefe lo ve en la siguiente consulta automática (cada 10 s), sin recargar.
  await expect(jefe.getByRole("region", { name: "En maquinado" }).getByText(code)).toBeVisible({ timeout: 15_000 });

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
  await page.getByRole("button", { name: "Agregar muestra de esta cotización" }).click();
  await page.getByLabel("Muestra", { exact: true }).fill(`M-${number}`);
  await page.getByLabel("Prueba", { exact: true }).selectOption("Flamabilidad Horizontal");
  await page.getByRole("button", { name: "Agregar muestra", exact: true }).click();
  await expect(page.getByRole("heading", { name: `M-${number}` })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).click();

  // La línea del tiempo junta las dos cosas.
  await page.getByRole("tab", { name: "Mi productividad" }).click();
  await expect(page.locator("#timeline").getByText(number).first()).toBeVisible();
  await expect(page.locator("#chartTypes").getByText("Elaborar cotización")).toBeVisible();
});

test("contraseña incorrecta", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Contraseña", { exact: true }).fill("no-es");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Contraseña incorrecta.");
});
