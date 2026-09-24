# Ежедневный парсинг остатков с вашего ПК + автоматическая публикация на сайте.
#
# Настройка (один раз, в PowerShell от своего пользователя):
#   schtasks /Create /TN "SaleTennis Parser" /SC DAILY /ST 09:00 `
#     /TR "powershell -ExecutionPolicy Bypass -File C:\путь\к\QWERTY\parser\run-and-push.ps1"
#
# Требования: Python + pip install -r parser/requirements.txt, Node.js + npm install,
# файл parser/.env с SALETENNIS_EMAIL / SALETENNIS_PASSWORD (в git не попадает).
# Компьютер должен быть включён в назначенное время.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "[INFO] Запуск HTTP-парсера SaleTennis..."
python parser\http_parser.py --out public/data
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Парсер завершился с ошибкой — push НЕ выполняю (данные сайта останутся прежними)."
    exit 1
}

Write-Host "[INFO] Сжимаю новые фотографии в WebP..."
npm run compress-images

git add public/data
if (git diff --cached --quiet) {
    Write-Host "[INFO] Данные не изменились — коммит не нужен."
} else {
    git commit -m ("data: парсинг остатков " + (Get-Date -Format "yyyy-MM-dd"))
    git pull --rebase
    git push
    Write-Host "[OK] Данные отправлены в репозиторий — Vercel пересоберёт сайт автоматически."
}
