declare module "xlsx-populate" {
  type CellValue = string | number | boolean | Date | null | undefined;

  type Range = {
    value(): CellValue[][];
  };

  type Sheet = {
    usedRange(): Range | undefined;
  };

  type Workbook = {
    sheet(index: number): Sheet | undefined;
  };

  const XlsxPopulate: {
    fromDataAsync(data: unknown): Promise<Workbook>;
  };

  export default XlsxPopulate;
}
