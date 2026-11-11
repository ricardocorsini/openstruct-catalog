# OpenStruct — distribuição

Catálogo público assinado, instaladores e infraestrutura de publicação do ecossistema OpenStruct.
Os códigos dos aplicativos continuam nos respectivos repositórios. A visibilidade desses
repositórios não é alterada por este projeto.

- `catalog.signed.json`: catálogo verificado pelo Struct Launcher (Ed25519).
- `launcher/latest.json`: atualização do launcher (assinaturas Tauri).
- `.github/workflows/release-product.yml`: build e publicação reutilizáveis para Windows e Linux.
- `.github/workflows/catalog.yml`: sincronização manual, por evento e aproximadamente a cada 15 minutos.
- `distribution.json`: lista explícita dos produtos, repositórios e chaves públicas autorizados.

Nunca inclua chaves privadas neste repositório. Não substitua arquivos de uma versão publicada.
Use uma nova versão/tag. Releases sem `openstruct-release.json` assinado não entram no catálogo.
As URLs de download são públicas e não exigem login nem token no computador do usuário.

Uma release somente é publicada depois que ambos os builds terminam. Antes de criar a tag,
versione as notas em português no repositório de código em `.github/release-notes/vX.Y.Z.md`
(por exemplo, `.github/release-notes/v0.7.0.md`; para beta, `v0.7.0-beta.1.md`).
O arquivo é obrigatório, deve conter Markdown não vazio e ter até 50.000 caracteres.
O preparo normaliza BOM, quebras de linha e espaços nas extremidades; o plano acompanha
os artefatos Windows e Linux, que precisam ter notas idênticas. O publicador valida o texto
novamente e o utiliza como descrição da release e como `manifest.notes` antes da assinatura.
Notas são apenas dados: nenhum código da fonte é executado pelo job de publicação.

Rascunhos existentes não definem as notas: seu texto é atualizado ao concluir a publicação.
Uploads existentes continuam sujeitos à conferência de hash, sem substituição; se um rascunho
já contém um manifesto com outras notas, remova apenas o rascunho ou use uma nova versão.
Nunca edite o manifesto assinado ou os instaladores publicados. Alterar apenas o texto no GitHub
depois de publicar não modifica as notas do catálogo ou do feed do Launcher.

Os horários do GitHub Actions são aproximados e podem sofrer atrasos. Repositórios públicos
sem atividade por 60 dias podem ter workflows agendados desabilitados pelo GitHub: confira
a aba Actions e execute a sincronização manual para reativá-los quando necessário.

## ArmaduraStruct

O ArmaduraStruct é compilado a partir de um commit e tag imutáveis de `ricardocorsini/armadura-struct`, pelo publicador autorizado `ricardocorsini/launcher-struct`. Os pacotes são publicados neste hub com prefixo `armadurastruct-v` e a identidade de assinatura de pacotes do publicador (`launcher-packages-v1`). A chave de catálogo permanece separada. Jobs de build não recebem chaves de assinatura nem token de publicação.

A configuração `publisherRepo` é uma lista de autorização: o tooling recusa outro publicador, outro repositório de código ou uma tag que não corresponda ao commit solicitado. Releases de produtos diferentes no mesmo hub são filtradas pelo prefixo antes de sua verificação. Launchers 0.2.x continuam compatíveis com as chaves e o esquema existentes; 0.2.2 inclui a gravura do aplicativo.

## GeoSPT

O produto `geosptstruct` usa o mesmo publicador delegado e a chave `launcher-packages-v1`, com código em `itanervale/GEOSPT-STRUCT`. A release no hub recebe o prefixo `geosptstruct-v`, com NSIS por usuário no Windows e AppImage no Linux, ambos x86_64. O manifesto vincula os pacotes ao GeoSPT, à versão e ao commit original; compartilhar a identidade do publicador não permite reutilizar pacotes de outro aplicativo.

No Launcher, o workflow **Build or publish GeoSPT** começa em modo de compilação: gera artefatos privados para conferir os instaladores sem alterar uma release ou o catálogo assinado. A publicação exige selecionar explicitamente essa opção e preparar antes a tag no repositório original. O catálogo base contém os metadados, com o símbolo OpenStruct enquanto a arte própria é tratada em outra etapa. Downloads só ficam disponíveis depois de publicada e verificada a release assinada.
