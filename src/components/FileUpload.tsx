import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { parseXLSX } from '../utils/xlsxParser';
import { useData } from '../context/DataContext';

export function FileUpload() {
  const { setData, setError, loading, setLoading } = useData();
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const isCSV = file.name.toLowerCase().endsWith('.csv');
    const isXLSX = /\.(xlsx|xls|xlsm|ods)$/i.test(file.name);

    if (!isCSV && !isXLSX) {
      setError('Поддерживаются только файлы .xlsx, .xls, .csv');
      setStatus('error');
      setStatusMessage('Неверный формат файла');
      return;
    }

    setLoading(true);
    setStatus('idle');
    setStatusMessage('');

    try {
      const parsedData = await parseXLSX(file);

      if (parsedData.products.length === 0) {
        throw new Error('Не удалось найти данные в файле');
      }

      // После setData приложение переключается на дашборд,
      // поэтому предупреждения парсера показываются уже там (в шапке).
      setData(parsedData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки';
      setError(message);
      setStatus('error');
      setStatusMessage(`❌ ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-white text-4xl">🎾</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">SaleTennis BI Analytics</h1>
          <p className="text-gray-500">Загрузите XLSX или CSV файл с данными по наличию товаров</p>
          <p className="text-sm text-green-600 mt-2">🏆 Умная аналитика для теннисных магазинов</p>
        </div>

        {/* Upload Area */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
            dragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              <p className="text-gray-600 font-medium">Обработка файла...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Upload className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-700 mb-1">Перетащите файл сюда</p>
                <p className="text-sm text-gray-500 mb-4">или нажмите для выбора</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Выбрать файл
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-4">
                <FileSpreadsheet className="w-4 h-4" />
                <span>XLSX, XLS или CSV (разделитель , ; или таб — определится автоматически)</span>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.ods,.csv"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div
            className={`mt-4 p-4 rounded-xl flex items-start gap-3 ${
              status === 'error'
                ? 'bg-red-50 border border-red-200'
                : 'bg-blue-50 border border-blue-200'
            }`}
          >
            {status === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            )}
            <p className={`text-sm ${status === 'error' ? 'text-red-700' : 'text-blue-700'}`}>
              {statusMessage}
            </p>
          </div>
        )}

        {/* Expected Formats */}
        <div className="mt-8 grid md:grid-cols-2 gap-4">
          {/* Формат A: длинный */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-gray-500" />
              Формат A: «длинный»
            </h3>
            <p className="text-xs text-gray-500 mb-3">Одна строка = один остаток. Рекомендуемый.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="text-left py-1.5 px-2 font-medium">Товар *</th>
                    <th className="text-left py-1.5 px-2 font-medium">Размер</th>
                    <th className="text-left py-1.5 px-2 font-medium">Магазин *</th>
                    <th className="text-left py-1.5 px-2 font-medium">Кол-во *</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-500">
                  <tr>
                    <td className="py-1.5 px-2">Кроссовки Nike</td>
                    <td className="py-1.5 px-2">42</td>
                    <td className="py-1.5 px-2">ТЦ Европа</td>
                    <td className="py-1.5 px-2">3</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-2">Кроссовки Nike</td>
                    <td className="py-1.5 px-2">43</td>
                    <td className="py-1.5 px-2">Склад</td>
                    <td className="py-1.5 px-2">5</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Дополнительные колонки: Бренд, Категория, Цена, Артикул. Повторяющиеся строки
              суммируются.
            </p>
          </div>

          {/* Формат B: широкий */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-gray-500" />
              Формат B: «широкий»
            </h3>
            <p className="text-xs text-gray-500 mb-3">Магазины — отдельные колонки.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="text-left py-1.5 px-2 font-medium">Название *</th>
                    <th className="text-left py-1.5 px-2 font-medium">Размеры и наличие</th>
                    <th className="text-left py-1.5 px-2 font-medium">Спб_Спортивная</th>
                    <th className="text-left py-1.5 px-2 font-medium">Екб_Склад</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-500">
                  <tr>
                    <td className="py-1.5 px-2">Кроссовки Nike</td>
                    <td className="py-1.5 px-2">43: Спб_Спортивная - 2 шт | Екб_Склад - 4</td>
                    <td className="py-1.5 px-2">2</td>
                    <td className="py-1.5 px-2">4</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-2">Мяч Wilson</td>
                    <td className="py-1.5 px-2"></td>
                    <td className="py-1.5 px-2">7</td>
                    <td className="py-1.5 px-2"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Наличие берётся из текста «Размеры и наличие», либо из чисел в колонках магазинов.
              Пустая ячейка = магазин не возит товар («—» в таблице, не влияет на % «нет в наличии»).
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          * — обязательные колонки. Названия колонок распознаются гибко: «товар / название /
          наименование», «количество / кол-во / остаток» и т.д.
        </p>
      </div>
    </div>
  );
}
