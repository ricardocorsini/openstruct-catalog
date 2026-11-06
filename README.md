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

Uma release somente é publicada depois que ambos os builds terminam. Notas de uma release
podem ser preparadas em um rascunho antes de disparar a tag. O manifesto assinado registra
essas notas; alterar o texto depois de publicar não modifica o catálogo já assinado.

Os horários do GitHub Actions são aproximados e podem sofrer atrasos. Repositórios públicos
sem atividade por 60 dias podem ter workflows agendados desabilitados pelo GitHub: confira
a aba Actions e execute a sincronização manual para reativá-los quando necessário.
