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
  await rodrigo.getByLabel("Prueba", { exact: true }).fill("FTIR");
  await rodrigo.getByLabel("Cliente", { exact: true }).fill("Cliente de prueba");
  await rodrigo.getByLabel("Recepción de probetas", { exact: true }).fill("2026-10-05");
  await rodrigo.getByLabel("Días hábiles comprometidos", { exact: true }).fill("7");
  await rodrigo.getByLabel("Días hábiles comprometidos", { exact: true }).blur();
  await expect(rodrigo.getByLabel("Fecha compromiso", { exact: true })).toHaveValue("2026-10-14");
  await rodrigo.getByRole("button", { name: "Agregar muestra" }).click();
  await expect(rodrigo.getByRole("heading", { name: code })).toBeVisible();
  await rodrigo.getByRole("button", { name: "Cerrar" }).click();

  await login(jefe, "clave-del-jefe");
  await expect(jefe.getByRole("button", { name: "Nueva muestra" })).toBeHidden();
  const recibido = jefe.getByRole("region", { name: "Recibido" });
  await expect(recibido.getByText(code)).toBeVisible();

  // Rodrigo pasa la muestra a VoBo con una nota.
  await rodrigo.getByText(code).click();
  await rodrigo.getByLabel("Nota del cambio", { exact: true }).fill("Enviado al cliente");
  await rodrigo.getByRole("button", { name: "Pasar a En VoBo" }).click();
  await expect(rodrigo.getByRole("dialog").getByText("Enviado al cliente")).toBeVisible();

  // El jefe lo ve en la siguiente consulta automática (cada 10 s), sin recargar.
  await expect(jefe.getByRole("region", { name: "En VoBo" }).getByText(code)).toBeVisible({ timeout: 15_000 });

  // El jefe abre el detalle: ve el historial pero no puede editar.
  await jefe.getByText(code).click();
  await expect(jefe.getByRole("dialog").getByText("Enviado al cliente")).toBeVisible();
  await expect(jefe.getByRole("button", { name: /Pasar a/ })).toHaveCount(0);
  await expect(jefe.getByLabel("Cliente", { exact: true })).toBeDisabled();
});

test("contraseña incorrecta", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Contraseña", { exact: true }).fill("no-es");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Contraseña incorrecta.");
});
