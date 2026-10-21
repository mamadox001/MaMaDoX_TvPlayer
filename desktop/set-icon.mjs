import * as ResEdit from 'resedit';
import fs from 'node:fs';
const exe = process.argv[2];
const ex = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(ex);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(process.argv[3]));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const id = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'MaMaDoX TvPlayer', ProductName: 'MaMaDoX TvPlayer', CompanyName: 'MaMaDoX', LegalCopyright: 'MaMaDoX', OriginalFilename: 'MaMaDoX TvPlayer.exe', InternalName: 'MaMaDoX TvPlayer' });
  vi.setFileVersion(1, 0, 0, 0, 1033);
  vi.setProductVersion(1, 0, 0, 0, 1033);
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(ex);
fs.writeFileSync(exe, Buffer.from(ex.generate()));
console.log('icon set');
