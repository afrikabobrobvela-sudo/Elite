@echo off
rem Actualiza la plataforma en linea: doble clic sobre este archivo dentro de la carpeta Elite.
rem Descarga la version nueva, instala dependencias, actualiza la base de datos y publica.

rem "git pull" puede cambiar este mismo archivo mientras corre; por eso se ejecuta una copia.
if not "%~1"=="--copia" (
  copy /y "%~f0" "%TEMP%\elite-configurar.cmd" >nul
  "%TEMP%\elite-configurar.cmd" --copia "%~dp0"
  exit /b
)

cd /d "%~2"
echo.
echo === Elite: actualizar la plataforma ===
echo Carpeta: %CD%
echo.

rem Si la carpeta vino de un zip no tiene .git: ya es la version nueva y no hay nada que descargar.
if exist ".git" (
  echo [1/4] Descargando la version nueva ^(git pull^)...
  git pull || goto :error
) else (
  echo [1/4] Carpeta descargada como zip: no hace falta git pull.
)

echo.
echo [2/4] Instalando dependencias (npm install)...
where npm >nul 2>nul || (
  echo No encuentro npm. Instala Node.js LTS desde https://nodejs.org, cierra esta ventana y vuelve a abrir configurar.cmd.
  goto :error
)
call npm install || goto :error

echo.
echo [3/4] Actualizando la base de datos en linea...
echo       Si pregunta si quieres continuar, escribe y y presiona Enter.
call npm run db:migrate:remote || goto :error

echo.
echo [4/4] Publicando la pagina (npm run deploy)...
call npm run deploy || goto :error

echo.
echo === Listo. Recarga la pagina en el navegador. ===
pause
exit /b 0

:error
echo.
echo *** Algo fallo en el paso de arriba. Copia lo que aparece en esta ventana y mandaselo a Claude. ***
pause
exit /b 1
